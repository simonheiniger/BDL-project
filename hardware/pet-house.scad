// BDL Pets – parametrisches NFC-Haus
// Unterseite hat eine Vertiefung fuer einen runden NFC-Sticker (z.B. NTAG213/215, 25 mm).
// Der Sticker enthaelt nur eine URL: https://<app>/pet/<id>?nfc  -> Handy oeffnet die Pet-Seite.
// Next step: NTAG 424 DNA (SUN/CMAC pro Scan) statt NTAG213, damit Tags nicht kopiert werden koennen.
//
// Render: openscad -o pet-house.stl pet-house.scad
// Varianten: openscad -D 'width=60' -D 'label="#7"' -o house-7.stl pet-house.scad

width = 50;          // Grundflaeche (mm)
depth = 50;
wall_h = 35;         // Wandhoehe bis Dachansatz
roof_h = 22;         // Dachhoehe ueber den Waenden
wall = 2.4;          // Wandstaerke
floor_t = 2.0;       // Bodenstaerke
door_w = 18;
door_h = 24;
nfc_d = 26;          // Durchmesser NFC-Sticker + Toleranz
nfc_depth = 0.8;     // Tiefe der Sticker-Vertiefung (Restboden ueber dem Tag = floor_t - nfc_depth)
label = "BDL";       // Praegung auf der Rueckwand
$fn = 64;

module body() {
    difference() {
        cube([width, depth, wall_h]);
        // Innenraum
        translate([wall, wall, floor_t]) cube([width - 2 * wall, depth - 2 * wall, wall_h]);
        // Tuer (Bogen)
        translate([width / 2, -1, floor_t]) {
            translate([-door_w / 2, 0, 0]) cube([door_w, wall + 2, door_h - door_w / 2]);
            translate([0, 0, door_h - door_w / 2]) rotate([-90, 0, 0]) cylinder(d = door_w, h = wall + 2);
        }
        // NFC-Vertiefung von unten
        translate([width / 2, depth / 2, -0.01]) cylinder(d = nfc_d, h = nfc_depth);
        // Praegung hinten
        translate([width / 2, depth - 0.79, wall_h / 2]) rotate([90, 0, 180])
            linear_extrude(0.8) text(label, size = 7, halign = "center", valign = "center");
    }
}

module roof() {
    overhang = 3;
    translate([-overhang, -overhang, wall_h])
        rotate([90, 0, 90])
            linear_extrude(width + 2 * overhang)
                polygon([[0, 0], [depth + 2 * overhang, 0], [(depth + 2 * overhang) / 2, roof_h]]);
}

body();
// Dach separat druckbar: auf -D 'part="roof"' umstellen
part = "all";
if (part == "all") roof();
