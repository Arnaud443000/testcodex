//! Minimal PDF page canvas: A4 pages, embedded TrueType fonts (Identity-H, so any
//! glyph of the font can be shown and text can be copied / searched), text
//! measurement, rectangles and lines. No layout decisions live here.

use pdf_writer::types::{FontFlags, SystemInfo, UnicodeCmap};
use pdf_writer::{Content, Date, Filter, Finish, Name, Pdf, Rect, Ref, Str, TextStr};
use std::collections::BTreeMap;

pub const PAGE_W: f32 = 595.28;
pub const PAGE_H: f32 = 841.89;

const REGULAR: &[u8] = include_bytes!("../../assets/fonts/Inter-Regular.ttf");
const BOLD: &[u8] = include_bytes!("../../assets/fonts/Inter-Bold.ttf");

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Weight {
    Regular,
    Bold,
}

/// An sRGB colour, 0–255 per channel.
#[derive(Clone, Copy)]
pub struct Rgb(pub u8, pub u8, pub u8);

struct Face {
    data: &'static [u8],
    face: ttf_parser::Face<'static>,
    /// Glyphs actually drawn: glyph id → character (for `/W` and `/ToUnicode`).
    used: BTreeMap<u16, char>,
}

impl Face {
    fn new(data: &'static [u8]) -> Self {
        Face { data, face: ttf_parser::Face::parse(data, 0).expect("embedded font is valid"), used: BTreeMap::new() }
    }

    /// Glyph of `c`; characters the font lacks become "?", never a blank box.
    fn glyph(&self, c: char) -> (u16, char) {
        let c = clean(c);
        match self.face.glyph_index(c) {
            Some(g) => (g.0, c),
            None => (self.face.glyph_index('?').map_or(0, |g| g.0), '?'),
        }
    }

    fn advance(&self, gid: u16) -> f32 {
        let units = self.face.glyph_hor_advance(ttf_parser::GlyphId(gid)).unwrap_or(0);
        f32::from(units) * 1000.0 / f32::from(self.face.units_per_em())
    }
}

/// Characters that must not reach the font as they are.
fn clean(c: char) -> char {
    match c {
        '\u{202F}' | '\u{2009}' => '\u{00A0}', // narrow spaces: not in the embedded subset
        '\t' | '\r' | '\n' | '\u{0B}' | '\u{0C}' => ' ',
        c if c.is_control() => ' ',
        c => c,
    }
}

pub struct Canvas {
    faces: [Face; 2],
    pages: Vec<Content>,
    current: usize,
}

impl Canvas {
    pub fn new() -> Self {
        Canvas { faces: [Face::new(REGULAR), Face::new(BOLD)], pages: vec![Content::new()], current: 0 }
    }

    pub fn page_count(&self) -> usize {
        self.pages.len()
    }

    pub fn new_page(&mut self) {
        self.pages.push(Content::new());
        self.current = self.pages.len() - 1;
    }

    /// Draws on page `index` (0-based) from now on; used for headers and footers once the page count is known.
    pub fn select_page(&mut self, index: usize) {
        self.current = index;
    }

    fn face(&self, w: Weight) -> &Face {
        &self.faces[w as usize]
    }

    /// Width of `text` in points.
    pub fn width(&self, text: &str, weight: Weight, size: f32) -> f32 {
        let face = self.face(weight);
        text.chars().map(|c| face.advance(face.glyph(c).0)).sum::<f32>() * size / 1000.0
    }

    /// Draws `text` with its baseline at `y` (from the page bottom), left edge at `x`.
    pub fn text(&mut self, x: f32, y: f32, text: &str, weight: Weight, size: f32, color: Rgb) {
        if text.is_empty() {
            return;
        }
        let face = &mut self.faces[weight as usize];
        let mut bytes = Vec::with_capacity(text.len() * 2);
        for c in text.chars() {
            let (gid, shown) = face.glyph(c);
            face.used.insert(gid, shown);
            bytes.extend_from_slice(&gid.to_be_bytes());
        }
        let name = if weight == Weight::Bold { Name(b"F2") } else { Name(b"F1") };
        let content = &mut self.pages[self.current];
        content.set_fill_rgb(f32::from(color.0) / 255.0, f32::from(color.1) / 255.0, f32::from(color.2) / 255.0);
        content.begin_text().set_font(name, size).next_line(x, y).show(Str(&bytes)).end_text();
    }

    /// Text whose right edge is at `right`.
    pub fn text_right(&mut self, right: f32, y: f32, text: &str, weight: Weight, size: f32, color: Rgb) {
        let w = self.width(text, weight, size);
        self.text(right - w, y, text, weight, size, color);
    }

    pub fn fill_rect(&mut self, x: f32, y: f32, w: f32, h: f32, color: Rgb) {
        let content = &mut self.pages[self.current];
        content.set_fill_rgb(f32::from(color.0) / 255.0, f32::from(color.1) / 255.0, f32::from(color.2) / 255.0);
        content.rect(x, y, w, h).fill_nonzero();
    }

    pub fn stroke_rect(&mut self, x: f32, y: f32, w: f32, h: f32, width: f32, color: Rgb) {
        let content = &mut self.pages[self.current];
        content.set_stroke_rgb(f32::from(color.0) / 255.0, f32::from(color.1) / 255.0, f32::from(color.2) / 255.0);
        content.set_line_width(width).rect(x, y, w, h).stroke();
    }

    pub fn hline(&mut self, x1: f32, x2: f32, y: f32, width: f32, color: Rgb) {
        let content = &mut self.pages[self.current];
        content.set_stroke_rgb(f32::from(color.0) / 255.0, f32::from(color.1) / 255.0, f32::from(color.2) / 255.0);
        content.set_line_width(width).move_to(x1, y).line_to(x2, y).stroke();
    }

    /// Serialises the document. `created` = (year, month 1–12, day, hour, minute, second), local time.
    pub fn finish(self, title: &str, created: (u16, u8, u8, u8, u8, u8)) -> Vec<u8> {
        let mut next = 1;
        let mut alloc = || {
            let r = Ref::new(next);
            next += 1;
            r
        };
        let (catalog, page_tree, info) = (alloc(), alloc(), alloc());
        // Per font: Type0, CIDFont, descriptor, font file, ToUnicode.
        let font_ids: Vec<[Ref; 5]> = (0..2).map(|_| [alloc(), alloc(), alloc(), alloc(), alloc()]).collect();
        let page_ids: Vec<(Ref, Ref)> = self.pages.iter().map(|_| (alloc(), alloc())).collect();

        let mut pdf = Pdf::new();
        pdf.set_version(1, 7);
        let (y, mo, d, h, mi, s) = created;
        pdf.document_info(info)
            .title(TextStr(title))
            .creator(TextStr("Pulse"))
            .producer(TextStr("Pulse (pdf-writer)"))
            .creation_date(Date::new(y).month(mo).day(d).hour(h).minute(mi).second(s));
        pdf.catalog(catalog).pages(page_tree).lang(TextStr("fr-FR"));
        pdf.pages(page_tree).kids(page_ids.iter().map(|p| p.0)).count(page_ids.len() as i32);

        let names = ["Inter-Regular", "Inter-Bold"];
        for (i, face) in self.faces.iter().enumerate() {
            let [type0, cid, desc, file, tounicode] = font_ids[i];
            let base = format!("{}+{}", if i == 0 { "PULSEA" } else { "PULSEB" }, names[i]);
            let base = Name(base.as_bytes());
            pdf.type0_font(type0)
                .base_font(base)
                .encoding_predefined(Name(b"Identity-H"))
                .descendant_font(cid)
                .to_unicode(tounicode);
            let mut cid_font = pdf.cid_font(cid);
            cid_font
                .subtype(pdf_writer::types::CidFontType::Type2)
                .base_font(base)
                .system_info(SystemInfo { registry: Str(b"Adobe"), ordering: Str(b"Identity"), supplement: 0 })
                .font_descriptor(desc)
                .default_width(500.0)
                .cid_to_gid_map_predefined(Name(b"Identity"));
            {
                let mut widths = cid_font.widths();
                for &gid in face.used.keys() {
                    widths.consecutive(gid, [face.advance(gid)]);
                }
            }
            cid_font.finish();

            let f = &face.face;
            let scale = 1000.0 / f32::from(f.units_per_em());
            let bb = f.global_bounding_box();
            pdf.font_descriptor(desc)
                .name(base)
                .flags(FontFlags::NON_SYMBOLIC)
                .bbox(Rect::new(
                    f32::from(bb.x_min) * scale,
                    f32::from(bb.y_min) * scale,
                    f32::from(bb.x_max) * scale,
                    f32::from(bb.y_max) * scale,
                ))
                .italic_angle(0.0)
                .ascent(f32::from(f.ascender()) * scale)
                .descent(f32::from(f.descender()) * scale)
                .cap_height(f.capital_height().map_or(700.0, |v| f32::from(v) * scale))
                .stem_v(if i == 0 { 80.0 } else { 140.0 })
                .font_file2(file);
            let compressed = miniz_oxide::deflate::compress_to_vec_zlib(face.data, 9);
            pdf.stream(file, &compressed).filter(Filter::FlateDecode).pair(Name(b"Length1"), face.data.len() as i32);

            let mut cmap = UnicodeCmap::new(
                Name(b"Custom"),
                SystemInfo { registry: Str(b"Adobe"), ordering: Str(b"UCS"), supplement: 0 },
            );
            for (&gid, &c) in &face.used {
                cmap.pair(gid, c);
            }
            pdf.cmap(tounicode, &cmap.finish());
        }

        for (content, (page, stream)) in self.pages.into_iter().zip(&page_ids) {
            let mut p = pdf.page(*page);
            p.parent(page_tree).media_box(Rect::new(0.0, 0.0, PAGE_W, PAGE_H)).contents(*stream);
            let mut res = p.resources();
            let mut fonts = res.fonts();
            fonts.pair(Name(b"F1"), font_ids[0][0]);
            fonts.pair(Name(b"F2"), font_ids[1][0]);
            fonts.finish();
            res.finish();
            p.finish();
            let compressed = miniz_oxide::deflate::compress_to_vec_zlib(&content.finish(), 6);
            pdf.stream(*stream, &compressed).filter(Filter::FlateDecode);
        }
        pdf.finish()
    }
}
