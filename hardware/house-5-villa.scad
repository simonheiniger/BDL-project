// Stufe 5: Villa - 5 Plaetze, Zufriedenheit -6/Tag. Zwei Stockwerke, Portikus mit Saeulen, Dachterrasse mit Gelaender.
include <lib.scad>

H5_P = [72, 54];
H5_GW = 58; H5_GD = 34; H5_GH = 16; H5_GY = 3;     // Erdgeschoss (Mitte y = 3 -> vorn y = -14)
H5_UW = 44; H5_UD = 26; H5_UH = 14; H5_UY = 6;     // Obergeschoss (vorn y = -7 -> Terrasse davor)
H5_FACE_G = H5_GD / 2 - H5_GY;                     // Abstand Vorderwand Erdgeschoss von y=0 (= 14)
H5_FACE_U = H5_UD / 2 - H5_UY;                     // Vorderwand Obergeschoss (= 7)

module h5_openings(fill) {
    z = PH;
    on_front(0, z, H5_FACE_G) opening(11, 14, 2, true, fill);
    for (x = [-19.5, 19.5]) on_front(x, z + 4, H5_FACE_G) opening(8, 9, 2, false, fill);
    for (k = [0, 1], y = [-4, 10]) on_side(k, y, z + 4, H5_GW / 2) opening(8, 9, 2, false, fill);
    for (x = [-14, 0, 14]) on_front(x, z + H5_GH + 3, H5_FACE_U) opening(8, 8, 2, false, fill);
    for (k = [0, 1]) on_side(k, H5_UY, z + H5_GH + 3, H5_UW / 2) opening(8, 8, 2, false, fill);
    for (x = [-14, 14]) on_back(x, z + 4, H5_GD / 2 + H5_GY) opening(8, 9, 2, false, fill);
}

module house5(part = 0) {
    z = PH;
    pc(1, part) plinth(H5_P[0], H5_P[1], 4);
    pc(2, part) {
        difference() {
            union() {
                box(H5_GW, H5_GD, H5_GH, z, 0, H5_GY);
                box(H5_UW, H5_UD, H5_UH, z + H5_GH, 0, H5_UY);
            }
            h5_openings(false);
        }
        for (x = [-10, -3.5, 3.5, 10]) translate([x, -21.5, z]) cylinder(d = 3, h = 15);   // Portikus-Saeulen
    }
    pc(3, part) {
        hip(H5_UW, H5_UD, 5, z + H5_GH + H5_UH, 2.5, 30, 0, H5_UY);
        box(26, 10, 2, z + 15, 0, -19);   // Portikus-Dach
    }
    pc(4, part) {
        h5_openings(true);
        tier_dots(H5_P[0], H5_P[1], 4, true);
        for (sx = [-1, 1]) translate([sx * 21, -13.2, z + H5_GH]) translate([-7, -0.5, 0]) cube([14, 1, 3]);   // Terrassen-Gelaender
    }
}

part = 0;
house5(part);
