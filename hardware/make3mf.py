#!/usr/bin/env python3
"""Baut aus den 4 Farbslot-STLs (out/<name>_c1..c4.stl) EINE 3MF mit 4 Teilen (Extruder 1..4).
Bambu-Format (Komponenten + Metadata/model_settings.config): Bambu Studio / OrcaSlicer zeigen 4 Teile, Teil -> Filament 1..4.
Aufruf: make3mf.py <name> [bett_x bett_y]   (Default Bett 256x256 = Bambu Lab A1)"""
import sys, zipfile
from pathlib import Path

NAMES = ["Stein-Sockel", "Waende", "Dach", "Akzente"]
COLORS = ["#8C9097", "#EADFC4", "#A5432F", "#33415F"]   # wie PALETTE in lib.scad

def read_stl(path):
    tris = []
    v = []
    for line in Path(path).read_text().splitlines():
        if "vertex" in line:
            v.append(tuple(float(x) for x in line.split()[1:4]))
            if len(v) == 3:
                tris.append(tuple(v)); v = []
    return tris

def main():
    name = sys.argv[1]
    bx, by = (float(sys.argv[2]), float(sys.argv[3])) if len(sys.argv) > 3 else (256.0, 256.0)
    parts = [read_stl(f"out/{name}_c{i}.stl") for i in range(1, 5)]
    pts = [p for part in parts for t in part for p in t]
    mn = [min(p[i] for p in pts) for i in range(3)]
    mx = [max(p[i] for p in pts) for i in range(3)]
    off = ((bx - (mx[0] - mn[0])) / 2 - mn[0], (by - (mx[1] - mn[1])) / 2 - mn[1], -mn[2])  # mittig aufs Bett, z=0

    # Bambu-Format: 4 Mesh-Objekte (ids 1..4, je ein Farbslot) + Assembly-Objekt 5 aus 4 Komponenten.
    # model_settings.config ordnet jedem Teil einen Extruder (= AMS-Slot) zu.
    objs, ntri = [], 0
    for pi, part in enumerate(parts):
        idx, verts, tris = {}, [], []
        for t in part:
            ids = []
            for p in t:
                k = tuple(round(c + o, 4) for c, o in zip(p, off))
                if k not in idx:
                    idx[k] = len(verts); verts.append(k)
                ids.append(idx[k])
            if len(set(ids)) == 3:
                tris.append(f'<triangle v1="{ids[0]}" v2="{ids[1]}" v3="{ids[2]}"/>')
        ntri += len(tris)
        objs.append(
            f'<object id="{pi + 1}" type="model"><mesh><vertices>'
            + "".join(f'<vertex x="{x}" y="{y}" z="{z}"/>' for x, y, z in verts)
            + "</vertices><triangles>" + "".join(tris) + "</triangles></mesh></object>")
    comps = "".join(f'<component objectid="{i}"/>' for i in range(1, 5))
    model = ('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" '
             'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'
             '<metadata name="Application">BambuStudio-01.10.00.00</metadata>\n<metadata name="BambuStudio:3mfVersion">1</metadata>\n'
             '<resources>\n' + "\n".join(objs)
             + f'\n<object id="5" type="model"><components>{comps}</components></object></resources>\n'
             '<build><item objectid="5" printable="1"/></build></model>')
    ident = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"
    partcfg = "".join(
        f'<part id="{i + 1}" subtype="normal_part"><metadata key="name" value="{NAMES[i]}"/>'
        f'<metadata key="matrix" value="{ident}"/><metadata key="extruder" value="{i + 1}"/></part>'
        for i in range(4))
    cfg = ('<?xml version="1.0" encoding="UTF-8"?>\n<config>\n'
           f'<object id="5"><metadata key="name" value="{name}"/><metadata key="extruder" value="1"/>{partcfg}</object>\n'
           '<plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value=""/><metadata key="locked" value="false"/>'
           '<model_instance><metadata key="object_id" value="5"/><metadata key="instance_id" value="0"/></model_instance></plate>\n</config>')
    ct = ('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
          '<Default Extension="config" ContentType="text/xml"/></Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
    out = f"out/{name}.3mf"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("3D/3dmodel.model", model)
        z.writestr("Metadata/model_settings.config", cfg)
    print(f"{out}: {ntri} Dreiecke, Groesse {mx[0]-mn[0]:.0f}x{mx[1]-mn[1]:.0f}x{mx[2]-mn[2]:.0f} mm")

main()
