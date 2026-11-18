// Stufe 2: Bauernhaus - 2 Plaetze, Zufriedenheit -30/Tag. Satteldach mit Kamin.
include <lib.scad>

H2_P = [50, 42];
H2_W = 36; H2_D = 28; H2_H = 18; H2_RH = 14; H2_OV = 3;

module h2_openings(fill) {
    z = PH;
    on_front(0, z, H2_D / 2) opening(10, 15, 2, true, fill);
    for (x = [-11, 11]) on_front(x, z + 8, H2_D / 2) opening(7, 7, 2, false, fill);
    for (k = [0, 1], y = [-6, 6]) on_side(k, y, z + 8, H2_W / 2) opening(7, 7, 2, false, fill);
    on_back(0, z + 8, H2_D / 2) opening(8, 7, 2, false, fill);
    on_front(0, z + H2_H + 4, H2_D / 2 + H2_OV) opening(7, 5, 2.5, false, fill);   // Heuboden-Fenster
}

module h2_chimney() { box(5, 5, 11, PH + H2_H, 9, 6); }

module house2(part = 0) {
    pc(1, part) { plinth(H2_P[0], H2_P[1], 1); h2_chimney(); }
    pc(2, part) difference() { box(H2_W, H2_D, H2_H, PH); h2_openings(false); }
    pc(3, part) difference() {
        gable(H2_W, H2_D, H2_RH, PH + H2_H, H2_OV);
        h2_openings(false);
        h2_chimney();
    }
    pc(4, part) { h2_openings(true); tier_dots(H2_P[0], H2_P[1], 1, true); }
}

part = 0;
house2(part);
