// Stufe 1: Huette - 1 Platz, Zufriedenheit -40/Tag. Kleiner Holzbau, steiles Strohdach.
include <lib.scad>

H1_P = [40, 40];
H1_W = 26; H1_D = 26; H1_H = 20; H1_RH = 17; H1_OV = 4;

module h1_openings(fill) {
    z = PH;
    on_front(0, z, H1_D / 2) opening(9, 14, 2, true, fill);
    for (k = [0, 1]) on_side(k, 0, z + 9, H1_W / 2) opening(7, 7, 2, false, fill);
    on_back(0, z + 9, H1_D / 2) opening(7, 7, 2, false, fill);
    // Giebelfenster im Dach
    on_front(0, z + H1_H + 3.5, H1_D / 2 + H1_OV) opening(6, 6, 2.5, false, fill);
}

module house1(part = 0) {
    pc(1, part) plinth(H1_P[0], H1_P[1], 0);
    pc(2, part) difference() { box(H1_W, H1_D, H1_H, PH); h1_openings(false); }
    pc(3, part) difference() { gable(H1_W, H1_D, H1_RH, PH + H1_H, H1_OV); h1_openings(false); }
    pc(4, part) { h1_openings(true); tier_dots(H1_P[0], H1_P[1], 0, true); }
}

part = 0;
house1(part);
