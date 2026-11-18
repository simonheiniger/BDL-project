// Stufe 3: Cottage - 3 Plaetze, Zufriedenheit -20/Tag. Walmdach, Vordach mit Pfosten, Kamin.
include <lib.scad>

H3_P = [56, 46];
H3_W = 40; H3_D = 30; H3_H = 20; H3_RH = 12; H3_OV = 3;

module h3_openings(fill) {
    z = PH;
    on_front(0, z, H3_D / 2) opening(10, 15, 2, true, fill);
    for (x = [-14, 14]) on_front(x, z + 8, H3_D / 2) opening(7, 8, 2, false, fill);
    for (k = [0, 1], y = [-8, 8]) on_side(k, y, z + 8, H3_W / 2) opening(7, 8, 2, false, fill);
    on_back(-8, z + 8, H3_D / 2) opening(7, 8, 2, false, fill);
    on_back(8, z + 8, H3_D / 2) opening(7, 8, 2, false, fill);
}

module h3_chimney() { box(5, 5, 15, PH + H3_H, -6, 0); }

module house3(part = 0) {
    pc(1, part) { plinth(H3_P[0], H3_P[1], 2); h3_chimney(); }
    pc(2, part) difference() { box(H3_W, H3_D, H3_H, PH); h3_openings(false); }
    pc(3, part) {
        difference() {
            hip(H3_W, H3_D, H3_RH, PH + H3_H, H3_OV, 18);
            h3_chimney();
        }
        box(18, 7, 2, PH + 14, 0, -18.5);   // Vordach ueber der Tuer
    }
    pc(4, part) {
        h3_openings(true);
        tier_dots(H3_P[0], H3_P[1], 2, true);
        for (x = [-7, 7]) translate([x, -21, PH]) cylinder(d = 2.4, h = 14);   // Pfosten
    }
}

part = 0;
house3(part);
