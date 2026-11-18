// Stufe 4: Herrenhaus - 4 Plaetze, Zufriedenheit -12/Tag. Zwei Stockwerke, runder Turm mit Kegeldach, Freitreppe.
include <lib.scad>

H4_P = [62, 50];
H4_CX = -6;                       // Hauptbau ist nach links verschoben, rechts steht der Turm
H4_W = 40; H4_D = 30; H4_H = 26; H4_RH = 12; H4_OV = 3;
H4_TX = 19; H4_TR = 9; H4_TH = 36;

module h4_openings(fill) {
    z = PH;
    on_front(H4_CX, z, H4_D / 2) opening(11, 15, 2, true, fill);
    for (x = [H4_CX - 11, H4_CX + 11]) on_front(x, z + 7, H4_D / 2) opening(7, 8, 2, false, fill);
    for (x = [H4_CX - 11, H4_CX, H4_CX + 11]) on_front(x, z + 17, H4_D / 2) opening(6, 7, 2, false, fill);
    for (y = [-6, 6]) {
        on_left(y, z + 7, H4_W / 2 - H4_CX) opening(7, 8, 2, false, fill);
        on_left(y, z + 17, H4_W / 2 - H4_CX) opening(6, 7, 2, false, fill);
    }
    for (x = [H4_CX - 8, H4_CX + 8]) on_back(x, z + 10, H4_D / 2) opening(7, 8, 2, false, fill);
    // Turm
    for (zz = [10, 22]) on_front(H4_TX, z + zz, H4_TR) opening(4, 9, 2.5, true, fill);
}

module h4_chimney() { box(5, 5, 15, PH + H4_H, H4_CX - 6, 0); }

module house4(part = 0) {
    pc(1, part) {
        plinth(H4_P[0], H4_P[1], 3);
        h4_chimney();
        box(14, 4, 1.2, PH, H4_CX, -17);   // Freitreppe
    }
    pc(2, part) difference() {
        union() {
            box(H4_W, H4_D, H4_H, PH, H4_CX, 0);
            translate([H4_TX, 0, PH]) cylinder(r = H4_TR, h = H4_TH);
        }
        h4_openings(false);
    }
    pc(3, part) {
        difference() {
            hip(H4_W, H4_D, H4_RH, PH + H4_H, H4_OV, 22, H4_CX, 0);
            h4_chimney();
        }
        translate([H4_TX, 0, PH + H4_TH]) cylinder(r1 = 11, r2 = 0, h = 14);
    }
    pc(4, part) { h4_openings(true); tier_dots(H4_P[0], H4_P[1], 3, true); }
}

part = 0;
house4(part);
