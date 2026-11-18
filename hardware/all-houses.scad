// Alle 5 Haus-Stufen auf einer Druckplatte (4 Farben: Stein / Waende / Dach / Akzente), ca. 140 x 110 mm.
//   Vorschau:   openscad all-houses.scad
//   Farb-STLs:  siehe render.sh (pro Farbslot ein STL, im Slicer als ein Objekt laden und Filamente zuweisen)
use <house-1-huette.scad>
use <house-2-bauernhaus.scad>
use <house-3-cottage.scad>
use <house-4-herrenhaus.scad>
use <house-5-villa.scad>

part = 0;   // 0 = Farbvorschau, 1..4 = nur dieser Farbslot

translate([0, 0, 0]) house1(part);
translate([51, 0, 0]) house2(part);
translate([110, 0, 0]) house3(part);
translate([0, -56, 0]) house4(part);
translate([73, -56, 0]) house5(part);
