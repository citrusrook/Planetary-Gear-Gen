"""Default parameter set (pb_math 'p' dict) - matches the FreeCAD object / web app defaults (V2)."""
DEFAULTS = dict(
    OD=31.7, ID=18.0, H=5.0,
    N=14, Zp=4, Zs=31, Zr=39,            # module 0.71, hunting tooth
    alpha=22.0, beta=30.0, reversals=1,
    expansion=0.1, root_clear=0.1, tip_land=0.025,
    hunting=False,
    min_planet_gap=0.3, min_wall=0.5, min_module=0.5,
    module_auto=True, module=0.5,
    shift_auto=True, shift=0.0,
    sun_bore_shape="Round", planet_bore_d=0.0, planet_bore_shape="Round",
    # taper (web app geometry; solver/report here): profile shift varies with height
    taper=0.0, taper_mirror=False, taper_flip=False,
    # surface textures on the ring OD ("od_") and the sun bore ("bore_", Round bores only)
    od_tex="None", od_tex_depth=0.2, od_tex_pitch=1.5, od_tex_angle=30.0, od_tex_size=1.2, od_tex_aspect=2.5,
    bore_tex="None", bore_tex_depth=0.2, bore_tex_pitch=1.2, bore_tex_angle=30.0, bore_tex_size=1.0, bore_tex_aspect=2.5,
)
# FreeCAD-only / mesh extras: EdgeChamfer=0.3, SunBoreFlat=0.4 (D-flat, fraction of ID),
# SurfaceTolerance=0.005, MeshDeviation=0.01

# V1 defaults (kept so the original FreeCAD export stays a regression reference)
DEFAULTS_V1 = dict(
    DEFAULTS, ID=22.0, N=24, Zs=56, Zr=64, expansion=0.15, root_clear=0.15, tip_land=0.1, min_module=0.4,
)
