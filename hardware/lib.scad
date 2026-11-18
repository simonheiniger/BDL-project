// BDL Pets - gemeinsame Bausteine fuer die 5 Haus-Stufen
//
// Alle Haeuser sind in genau 4 Farbslots aufgeteilt (Multicolor-Druck, z.B. Bambu AMS / Prusa MMU):
//   1 Stein/Sockel   2 Waende   3 Dach   4 Akzente (Tueren, Fenster, Pfosten, Stufen-Punkte)
// Die Teile ueberlappen nicht (Oeffnungen werden aus der einen Farbe geschnitten und in der anderen gefuellt),
// jeder Farbslot laesst sich einzeln als STL exportieren:  openscad -D part=1 -o x_c1.stl house-1-huette.scad
//   part = 0 -> Vorschau in Farbe, 1..4 -> nur dieser Farbslot
//
// Unten (Sockel) ist mittig eine runde Ausnehmung fuer einen NFC-Sticker (Durchmesser 25 mm) ausgespart:
// Sticker von unten einkleben, buendig mit der Unterseite, 2.2 mm Kunststoff darueber (Lesen durch das Haus).

$fn = 40;

PH = 3.6;           // Sockelhoehe (mm)
NFC_D = 27;         // Ausnehmung: 25 mm Sticker + Spiel
NFC_DEPTH = 1.4;    // Tiefe von unten (NTAG-Sticker ~0.3-0.6 mm dick + Kleber) -> Restdecke = PH - NFC_DEPTH
PALETTE = ["#8c9097", "#eadfc4", "#a5432f", "#33415f"];

module pc(i, part) {
    if (part == 0) color(PALETTE[i - 1]) children();
    else if (part == i) children();
}

// ---------------------------------------------------------------- Sockel (Farbe 1)
module plinth(w, d, tier) {
    difference() {
        hull() {
            translate([-w / 2, -d / 2, 0]) cube([w, d, PH * 0.55]);
            translate([-w / 2 + 0.8, -d / 2 + 0.8, 0]) cube([w - 1.6, d - 1.6, PH]);
        }
        translate([0, 0, -0.01]) cylinder(d = NFC_D, h = NFC_DEPTH + 0.01);   // NFC-Sticker
        tier_dots(w, d, tier, false);
    }
}

// Stufen-Punkte an der Sockel-Vorderseite: 1 Punkt = Huette ... 5 Punkte = Villa (Farbe 4 fuellt sie)
module tier_dots(w, d, tier, fill) {
    for (i = [0 : tier])
        translate([(i - tier / 2) * 4.5, -d / 2 - (fill ? 0.4 : 1), 1.0])
            rotate([-90, 0, 0]) cylinder(d = 1.6, h = fill ? 1.4 : 2);
}

// ---------------------------------------------------------------- Koerper
module box(w, d, h, z0, cx = 0, cy = 0) {
    translate([cx - w / 2, cy - d / 2, z0]) cube([w, d, h]);
}

// Satteldach, First entlang Y (Giebel zeigt nach vorn)
module gable(w, d, h, z0, over, cx = 0, cy = 0) {
    translate([cx, cy + (d + 2 * over) / 2, z0]) rotate([90, 0, 0])
        linear_extrude(d + 2 * over) polygon([[-w / 2 - over, 0], [w / 2 + over, 0], [0, h]]);
}

// Walmdach, First entlang X
module hip(w, d, h, z0, over, ridge, cx = 0, cy = 0) {
    hull() {
        translate([cx - w / 2 - over, cy - d / 2 - over, z0]) cube([w + 2 * over, d + 2 * over, 0.01]);
        translate([cx - ridge / 2, cy - 0.4, z0 + h - 0.01]) cube([ridge, 0.8, 0.01]);
    }
}

// ---------------------------------------------------------------- Oeffnungen (Tueren/Fenster)
// Ursprung = Unterkante Mitte, ragt von der Wandflaeche (y=0) nach innen (+y).
// fill=false: Schneidkoerper (steht 1 mm ueber), fill=true: Einsatz aus Farbe 4 (steht 0.4 mm vor)
module opening(w, h, d = 2, arch = false, fill = false) {
    out = fill ? 0.4 : 1;
    translate([0, -out, 0]) {
        if (arch) {
            translate([-w / 2, 0, 0]) cube([w, out + d, h - w / 2]);
            translate([0, 0, h - w / 2]) rotate([-90, 0, 0]) cylinder(d = w, h = out + d);
        } else {
            translate([-w / 2, 0, 0]) cube([w, out + d, h]);
        }
    }
}

// Auf eine Wand setzen. `face` = Abstand der Wandflaeche von der Mitte
module on_front(x, z, face) { translate([x, -face, z]) children(); }
module on_back(x, z, face) { translate([x, face, z]) rotate([0, 0, 180]) children(); }
module on_left(y, z, face) { translate([-face, y, z]) rotate([0, 0, -90]) children(); }
module on_right(y, z, face) { translate([face, y, z]) rotate([0, 0, 90]) children(); }

module on_side(k, y, z, face) {   // k = 0 links, 1 rechts
    if (k == 0) on_left(y, z, face) children();
    else on_right(y, z, face) children();
}
