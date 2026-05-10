use image::{GenericImageView, imageops::FilterType};
use std::{env, io::{self, Write}, process};
use terminal_size::{Width, terminal_size};

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Normal,
    Green, Amber,
    Grunge, GreenGrunge, AmberGrunge,
    Ascii, AsciiGreen, AsciiAmber,
    Ansi16,
    Rainbow, Thermal, Neon, Glitch,
    Custom(u8, u8, u8),
}

impl Mode {
    fn from_str(s: &str) -> Option<Self> {
        match s {
            "normal"       => Some(Self::Normal),
            "green"        => Some(Self::Green),
            "amber"        => Some(Self::Amber),
            "grunge"       => Some(Self::Grunge),
            "green-grunge" => Some(Self::GreenGrunge),
            "amber-grunge" => Some(Self::AmberGrunge),
            "ascii"        => Some(Self::Ascii),
            "ascii-green"  => Some(Self::AsciiGreen),
            "ascii-amber"  => Some(Self::AsciiAmber),
            "16color"      => Some(Self::Ansi16),
            "rainbow"      => Some(Self::Rainbow),
            "thermal"      => Some(Self::Thermal),
            "neon"         => Some(Self::Neon),
            "glitch"       => Some(Self::Glitch),
            "custom"       => Some(Self::Custom(0, 255, 238)), // default cyan; overridden by -c
            _ => None,
        }
    }
    fn is_ascii(self) -> bool {
        matches!(self, Self::Ascii | Self::AsciiGreen | Self::AsciiAmber)
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();

    let mut cols_arg: Option<u32> = None;
    let mut rows_arg: Option<u32> = None;
    let mut mode = Mode::Normal;
    let mut custom_color: Option<(u8, u8, u8)> = None;
    let mut path: Option<String> = None;
    let mut i = 1;

    while i < args.len() {
        match args[i].as_str() {
            "-w" | "--width" => {
                i += 1;
                if i < args.len() { cols_arg = args[i].parse().ok(); }
            }
            "-r" | "--rows" => {
                i += 1;
                if i < args.len() { rows_arg = args[i].parse().ok(); }
            }
            "-m" | "--mode" => {
                i += 1;
                if i < args.len() {
                    match Mode::from_str(&args[i]) {
                        Some(m) => mode = m,
                        None => {
                            eprintln!("unknown mode '{}'. See --help.", args[i]);
                            process::exit(1);
                        }
                    }
                }
            }
            "-c" | "--color" => {
                i += 1;
                if i < args.len() {
                    match parse_hex_color(&args[i]) {
                        Some(c) => custom_color = Some(c),
                        None => {
                            eprintln!("invalid color '{}' — expected RRGGBB hex (e.g. ff00ee)", args[i]);
                            process::exit(1);
                        }
                    }
                }
            }
            "-h" | "--help" => { print_help(); process::exit(0); }
            arg => { path = Some(arg.to_string()); }
        }
        i += 1;
    }

    // Apply custom color: -c alone implies custom mode; -m custom uses -c if given
    match mode {
        Mode::Custom(_, _, _) => {
            if let Some((r, g, b)) = custom_color {
                mode = Mode::Custom(r, g, b);
            }
        }
        _ => {
            if let Some((r, g, b)) = custom_color {
                mode = Mode::Custom(r, g, b);
            }
        }
    }

    let path = match path {
        Some(p) => p,
        None => { eprintln!("usage: imgterm [-w cols] [-r rows] [-m mode] [-c RRGGBB] <image>"); process::exit(1); }
    };

    let img = match image::open(&path) {
        Ok(img) => img,
        Err(e) => { eprintln!("error: {}", e); process::exit(1); }
    };

    let cols = cols_arg.unwrap_or_else(|| {
        if let Some((Width(w), _)) = terminal_size() { (w as u32).saturating_sub(1) } else { 80 }
    });

    let (img_w, img_h) = img.dimensions();
    let rows = {
        let r = (cols * img_h / img_w / 2).max(1);
        rows_arg.map(|cap| r.min(cap)).unwrap_or(r)
    };

    let mut out: Vec<u8> = Vec::with_capacity((cols * rows * 32) as usize);

    if mode.is_ascii() {
        let scaled = img.resize_exact(cols, rows, FilterType::Lanczos3).into_rgba8();
        for y in 0..rows {
            let mut last_fg: Option<(u8, u8, u8)> = None;
            for x in 0..cols {
                let rgb = blend(scaled.get_pixel(x, y).0);
                let l = lum(rgb);

                let fg = match mode {
                    Mode::AsciiGreen => Some(phosphor_green(rgb)),
                    Mode::AsciiAmber => Some(phosphor_amber(rgb)),
                    _ => None,
                };

                if let Some(fg) = fg {
                    if last_fg != Some(fg) {
                        emit_rgb_fg(&mut out, fg);
                        last_fg = Some(fg);
                    }
                }

                out.push(lum_to_ascii(l));
            }
            if mode != Mode::Ascii { out.extend_from_slice(b"\x1b[0m"); }
            out.push(b'\n');
        }
    } else if mode == Mode::Ansi16 {
        let scaled = img.resize_exact(cols, rows * 2, FilterType::Lanczos3).into_rgba8();
        for y in 0..rows {
            let mut last_fg: Option<usize> = None;
            let mut last_bg: Option<usize> = None;
            for x in 0..cols {
                let tf = bayer_quantize(blend(scaled.get_pixel(x, y * 2).0),     x, y * 2);
                let bf = bayer_quantize(blend(scaled.get_pixel(x, y * 2 + 1).0), x, y * 2 + 1);

                if last_fg != Some(tf) { emit_ansi16_fg(&mut out, tf); last_fg = Some(tf); }
                if last_bg != Some(bf) { emit_ansi16_bg(&mut out, bf); last_bg = Some(bf); }
                out.extend_from_slice(b"\xe2\x96\x80");
            }
            out.extend_from_slice(b"\x1b[0m\n");
        }
    } else {
        let w = cols;
        let h = rows * 2;
        let scaled = img.resize_exact(cols, h, FilterType::Lanczos3).into_rgba8();
        for y in 0..rows {
            let mut last_fg: Option<(u8, u8, u8)> = None;
            let mut last_bg: Option<(u8, u8, u8)> = None;
            for x in 0..cols {
                let fg = apply_mode(blend(scaled.get_pixel(x, y * 2).0),     mode, x, y * 2,     w, h);
                let bg = apply_mode(blend(scaled.get_pixel(x, y * 2 + 1).0), mode, x, y * 2 + 1, w, h);

                if last_fg != Some(fg) { emit_rgb_fg(&mut out, fg); last_fg = Some(fg); }
                if last_bg != Some(bg) { emit_rgb_bg(&mut out, bg); last_bg = Some(bg); }
                out.extend_from_slice(b"\xe2\x96\x80");
            }
            out.extend_from_slice(b"\x1b[0m\n");
        }
    }

    io::stdout().write_all(&out).unwrap();
}

// --- Color transforms ---

fn apply_mode(rgb: (u8, u8, u8), mode: Mode, x: u32, y: u32, w: u32, h: u32) -> (u8, u8, u8) {
    match mode {
        Mode::Normal              => rgb,
        Mode::Green               => phosphor_green(rgb),
        Mode::Amber               => phosphor_amber(rgb),
        Mode::Grunge              => grunge(rgb, x, y, w, h),
        Mode::GreenGrunge         => phosphor_green(grunge(rgb, x, y, w, h)),
        Mode::AmberGrunge         => phosphor_amber(grunge(rgb, x, y, w, h)),
        Mode::Rainbow             => rainbow(rgb, x, w),
        Mode::Thermal             => thermal(rgb),
        Mode::Neon                => neon(rgb),
        Mode::Glitch              => glitch(rgb, x, y, w, h),
        Mode::Custom(cr, cg, cb)  => phosphor_custom(rgb, (cr, cg, cb)),
        _ => rgb,
    }
}

fn phosphor_green(rgb: (u8, u8, u8)) -> (u8, u8, u8) {
    let l = lum(rgb);
    let l2 = l * l;
    ((l2 * 30.0) as u8, (l * 210.0 + l2 * 45.0) as u8, (l2 * 60.0) as u8)
}

fn phosphor_amber(rgb: (u8, u8, u8)) -> (u8, u8, u8) {
    let l = lum(rgb);
    let l2 = l * l;
    ((l * 220.0 + l2 * 35.0) as u8, (l * 100.0 + l2 * 30.0) as u8, (l2 * 10.0) as u8)
}

fn phosphor_custom(rgb: (u8, u8, u8), color: (u8, u8, u8)) -> (u8, u8, u8) {
    let l = lum(rgb);
    let l2 = l * l;
    let t = l * 0.85 + l2 * 0.15;
    let r = (t * color.0 as f32).min(255.0) as u8;
    let g = (t * color.1 as f32).min(255.0) as u8;
    let b = (t * color.2 as f32).min(255.0) as u8;
    (r, g, b)
}

fn grunge(rgb: (u8, u8, u8), x: u32, y: u32, w: u32, h: u32) -> (u8, u8, u8) {
    let (mut r, mut g, mut b) = (rgb.0 as f32, rgb.1 as f32, rgb.2 as f32);
    let n = (hash(x, y) as f32 / 255.0 - 0.5) * 50.0;
    r += n; g += n; b += n;
    if y % 3 == 0 { r *= 0.45; g *= 0.45; b *= 0.45; }
    let fx = x as f32 / w as f32 - 0.5;
    let fy = y as f32 / h as f32 - 0.5;
    let v = (1.0 - (fx * fx + fy * fy) * 2.2).clamp(0.0, 1.0);
    r *= v; g *= v; b *= v;
    (r.clamp(0.0, 255.0) as u8, g.clamp(0.0, 255.0) as u8, b.clamp(0.0, 255.0) as u8)
}

fn rainbow(rgb: (u8, u8, u8), x: u32, w: u32) -> (u8, u8, u8) {
    let l = lum(rgb);
    let hue = (x as f32 / w as f32) * 360.0;
    let v = (l * 1.2).min(1.0);
    hsv_to_rgb(hue, 1.0, v)
}

fn thermal(rgb: (u8, u8, u8)) -> (u8, u8, u8) {
    let l = lum(rgb);
    // Gradient: black → violet → blue → cyan → green → yellow → red → white
    let stops: &[(f32, (f32,f32,f32))] = &[
        (0.00, (0.0,   0.0,   0.0  )),
        (0.15, (0.24,  0.0,   0.39 )),
        (0.30, (0.0,   0.0,   1.0  )),
        (0.45, (0.0,   1.0,   1.0  )),
        (0.60, (0.0,   1.0,   0.0  )),
        (0.75, (1.0,   1.0,   0.0  )),
        (0.90, (1.0,   0.0,   0.0  )),
        (1.00, (1.0,   1.0,   1.0  )),
    ];
    let l = l.clamp(0.0, 1.0);
    let idx = stops.partition_point(|&(t, _)| t <= l).saturating_sub(1).min(stops.len() - 2);
    let (t0, c0) = stops[idx];
    let (t1, c1) = stops[idx + 1];
    let frac = if t1 > t0 { (l - t0) / (t1 - t0) } else { 0.0 };
    let lerp = |a: f32, b: f32| ((a + (b - a) * frac) * 255.0).clamp(0.0, 255.0) as u8;
    (lerp(c0.0, c1.0), lerp(c0.1, c1.1), lerp(c0.2, c1.2))
}

fn neon(rgb: (u8, u8, u8)) -> (u8, u8, u8) {
    let (r, g, b) = (rgb.0 as f32, rgb.1 as f32, rgb.2 as f32);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    let l = lum(rgb);

    if max < 1.0 { return (0, 0, 0); }

    // Extract hue
    let hue = if delta < 0.5 {
        0.0_f32
    } else if max == r {
        let h = 60.0 * ((g - b) / delta);
        if h < 0.0 { h + 360.0 } else { h }
    } else if max == g {
        60.0 * ((b - r) / delta + 2.0)
    } else {
        60.0 * ((r - g) / delta + 4.0)
    };

    // Boost contrast, max saturation, shift hue 20° toward magenta/pink
    let v = (l * 1.5).min(1.0).powf(0.75);
    let shifted = (hue + 20.0) % 360.0;
    hsv_to_rgb(shifted, 1.0, v)
}

fn glitch(rgb: (u8, u8, u8), x: u32, y: u32, _w: u32, _h: u32) -> (u8, u8, u8) {
    let (r, g, b) = (rgb.0 as f32, rgb.1 as f32, rgb.2 as f32);
    // Per-region severity (groups of 2 pixel rows = 1 char row)
    let row_seed = hash(y.wrapping_mul(0x9e3779b9), y ^ 0xbeef1234);

    // ~8%: hard glitch bar — solid vivid color block
    if row_seed < 20 {
        let v = hash(x ^ (x >> 2), y) as f32;
        return match row_seed % 4 {
            0 => (255, 0,          (v * 0.4) as u8),
            1 => (0,   (v * 0.4) as u8, 255),
            2 => ((v * 0.4) as u8, 255, 255),
            _ => (255, (v * 0.3) as u8, 255),
        };
    }

    // ~18%: chromatic aberration — R and B channels pulled apart
    if row_seed < 65 {
        let shift = (hash(y, 0xdeadbeef) % 6 + 1) as u32;
        let rn = hash(x.wrapping_add(shift), y) as f32 / 255.0;
        let bn = hash(x.wrapping_sub(shift), y) as f32 / 255.0;
        let mix = 0.4;
        let nr = (r * (1.0 - mix) + rn * r * mix + rn * 80.0 * mix).clamp(0.0, 255.0);
        let nb = (b * (1.0 - mix) + bn * b * mix + bn * 80.0 * mix).clamp(0.0, 255.0);
        return (nr as u8, g as u8, nb as u8);
    }

    // Base: light digital noise
    let n = (hash(x, y) as f32 / 255.0 - 0.5) * 16.0;
    ((r + n).clamp(0.0, 255.0) as u8, (g + n).clamp(0.0, 255.0) as u8, (b + n).clamp(0.0, 255.0) as u8)
}

// --- ASCII ---

fn lum_to_ascii(l: f32) -> u8 {
    const RAMP: &[u8] = b" .,:;i1tfjrxnuvczYUJCLQ0OZmwqpdbkhao*#MW8%B@$";
    RAMP[((l * (RAMP.len() - 1) as f32) as usize).min(RAMP.len() - 1)]
}

// --- 16-color ---

const ANSI16: [(u8, u8, u8); 16] = [
    (0,   0,   0  ), (170, 0,   0  ), (0,   170, 0  ), (170, 170, 0  ),
    (0,   0,   170), (170, 0,   170), (0,   170, 170), (170, 170, 170),
    (85,  85,  85 ), (255, 85,  85 ), (85,  255, 85 ), (255, 255, 85 ),
    (85,  85,  255), (255, 85,  255), (85,  255, 255), (255, 255, 255),
];

#[rustfmt::skip]
const BAYER4: [[i32; 4]; 4] = [
    [ 0,  8,  2, 10],
    [12,  4, 14,  6],
    [ 3, 11,  1,  9],
    [15,  7, 13,  5],
];

fn bayer_quantize(rgb: (u8, u8, u8), x: u32, y: u32) -> usize {
    let t = BAYER4[(y % 4) as usize][(x % 4) as usize] * 8 - 60;
    let r = (rgb.0 as i32 + t).clamp(0, 255) as u8;
    let g = (rgb.1 as i32 + t).clamp(0, 255) as u8;
    let b = (rgb.2 as i32 + t).clamp(0, 255) as u8;
    ANSI16.iter().enumerate()
        .min_by_key(|(_, &(cr, cg, cb))| {
            let (dr, dg, db) = (r as i32 - cr as i32, g as i32 - cg as i32, b as i32 - cb as i32);
            dr*dr + dg*dg + db*db
        })
        .map(|(i, _)| i).unwrap()
}

fn emit_ansi16_fg(buf: &mut Vec<u8>, n: usize) {
    if n < 8 { buf.extend_from_slice(b"\x1b[3"); buf.push(b'0' + n as u8); buf.push(b'm'); }
    else      { buf.extend_from_slice(b"\x1b[9"); buf.push(b'0' + (n-8) as u8); buf.push(b'm'); }
}

fn emit_ansi16_bg(buf: &mut Vec<u8>, n: usize) {
    if n < 8 { buf.extend_from_slice(b"\x1b[4");  buf.push(b'0' + n as u8); buf.push(b'm'); }
    else      { buf.extend_from_slice(b"\x1b[10"); buf.push(b'0' + (n-8) as u8); buf.push(b'm'); }
}

// --- Shared utils ---

#[inline] fn lum(rgb: (u8, u8, u8)) -> f32 {
    0.2126 * rgb.0 as f32 / 255.0 + 0.7152 * rgb.1 as f32 / 255.0 + 0.0722 * rgb.2 as f32 / 255.0
}

#[inline] fn hash(x: u32, y: u32) -> u8 {
    let mut h = x.wrapping_mul(2246822519).wrapping_add(y.wrapping_mul(3266489917));
    h ^= h >> 16; h = h.wrapping_mul(2246822519); (h >> 24) as u8
}

#[inline] fn blend(p: [u8; 4]) -> (u8, u8, u8) {
    let [r, g, b, a] = p;
    if a == 255 { return (r, g, b); }
    if a == 0   { return (0, 0, 0); }
    let af = a as f32 / 255.0;
    ((r as f32 * af) as u8, (g as f32 * af) as u8, (b as f32 * af) as u8)
}

fn emit_rgb_fg(buf: &mut Vec<u8>, c: (u8, u8, u8)) {
    buf.extend_from_slice(b"\x1b[38;2;");
    write_u8(buf, c.0); buf.push(b';'); write_u8(buf, c.1); buf.push(b';'); write_u8(buf, c.2); buf.push(b'm');
}

fn emit_rgb_bg(buf: &mut Vec<u8>, c: (u8, u8, u8)) {
    buf.extend_from_slice(b"\x1b[48;2;");
    write_u8(buf, c.0); buf.push(b';'); write_u8(buf, c.1); buf.push(b';'); write_u8(buf, c.2); buf.push(b'm');
}

fn write_u8(buf: &mut Vec<u8>, n: u8) {
    if n >= 100 { buf.push(b'0' + n/100); buf.push(b'0' + (n/10)%10); buf.push(b'0' + n%10); }
    else if n >= 10 { buf.push(b'0' + n/10); buf.push(b'0' + n%10); }
    else { buf.push(b'0' + n); }
}

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (u8, u8, u8) {
    let c = v * s;
    let h6 = h / 60.0;
    let x = c * (1.0 - (h6 % 2.0 - 1.0).abs());
    let m = v - c;
    let (r1, g1, b1) = if      h6 < 1.0 { (c, x, 0.0) }
                        else if h6 < 2.0 { (x, c, 0.0) }
                        else if h6 < 3.0 { (0.0, c, x) }
                        else if h6 < 4.0 { (0.0, x, c) }
                        else if h6 < 5.0 { (x, 0.0, c) }
                        else              { (c, 0.0, x) };
    (((r1 + m) * 255.0).clamp(0.0, 255.0) as u8,
     ((g1 + m) * 255.0).clamp(0.0, 255.0) as u8,
     ((b1 + m) * 255.0).clamp(0.0, 255.0) as u8)
}

fn parse_hex_color(s: &str) -> Option<(u8, u8, u8)> {
    let s = s.trim_start_matches('#');
    if s.len() != 6 { return None; }
    let r = u8::from_str_radix(&s[0..2], 16).ok()?;
    let g = u8::from_str_radix(&s[2..4], 16).ok()?;
    let b = u8::from_str_radix(&s[4..6], 16).ok()?;
    Some((r, g, b))
}

fn print_help() {
    eprintln!("usage: imgterm [-w cols] [-r rows] [-m mode] [-c RRGGBB] <image>");
    eprintln!("  Converts an image to ANSI truecolor terminal art.");
    eprintln!("  Supports: PNG, JPEG, GIF, BMP, TIFF, WebP");
    eprintln!("");
    eprintln!("  -w N         output width in columns (default: terminal width)");
    eprintln!("  -r N         cap output height in rows (default: auto from aspect ratio)");
    eprintln!("  -c RRGGBB    custom phosphor color hex (implies -m custom)");
    eprintln!("");
    eprintln!("  Modes (-m):");
    eprintln!("    normal        24-bit half-block, full color (default)");
    eprintln!("    green         P1 phosphor green");
    eprintln!("    amber         P3 phosphor amber");
    eprintln!("    grunge        Noise + scanlines + vignette");
    eprintln!("    green-grunge  Green phosphor + grunge");
    eprintln!("    amber-grunge  Amber phosphor + grunge");
    eprintln!("    ascii         ASCII density art, monochrome");
    eprintln!("    ascii-green   ASCII density art, green tinted");
    eprintln!("    ascii-amber   ASCII density art, amber tinted");
    eprintln!("    16color       Bayer-dithered 16-color half-blocks");
    eprintln!("    rainbow       Horizontal hue sweep, full spectrum");
    eprintln!("    thermal       Heat-map gradient (cold blue → hot red)");
    eprintln!("    neon          Max saturation + contrast, shifted hues");
    eprintln!("    glitch        Digital corruption: bars + channel shift");
    eprintln!("    custom        User-defined phosphor color (use -c RRGGBB)");
    eprintln!("");
    eprintln!("  Tip: drag an image onto imgterm.exe in Explorer to use it.");
}
