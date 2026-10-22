"""Default parameter set (pb_math 'p' dict) - matches the FreeCAD object / web app defaults (V3)."""
DEFAULTS = dict(
    OD=31.7, ID=18.0, H=5.0,
    N=14, Zp=4, Zs=31, Zr=39,            # module 0.71, hunting tooth
    alpha=22.0, beta=30.0, reversals=1,
    expansion=0.1, root_clear=0.08, tip_land=0.025,
    hunting=False,
    min_planet_gap=0.3, min_module=0.5,
    # walls, separate from the teeth: min / max (0 = no max) for the ring wall and the sun rim
    ring_wall_min=0.5, ring_wall_max=0.0, sun_wall_min=0.5, sun_wall_max=0.0,
    # module: "Auto" (planets centred, m=(OD+ID)/(Zs+Zr)), "Manual" (module), "Walls" (fill the space
    # between the wall targets ring_wall / sun_wall)
    module_mode="Auto", module=0.5, ring_wall=0.8, sun_wall=0.8,
    shift_auto=True, shift=0.0,
    sun_bore_shape="Round", planet_bore_d=0.0, planet_bore_shape="Round",
    # Spline sun bore (ID = spline pitch diameter) with a matching shaft
    spline_teeth=12, spline_alpha=30.0, shaft_length=15.0, shaft_bore=0.0,
    # taper: angle of the load-carrying flanks (V3); profile shift varies with height
    taper=0.0, taper_mirror=False, taper_flip=False,
    # surface textures on the ring OD ("od_") and the sun bore ("bore_", Round bores only)
    od_tex="None", od_tex_depth=0.2, od_tex_pitch=1.5, od_tex_angle=30.0, od_tex_size=1.2, od_tex_aspect=2.5,
    bore_tex="None", bore_tex_depth=0.2, bore_tex_pitch=1.2, bore_tex_angle=30.0, bore_tex_size=1.0, bore_tex_aspect=2.5,
    # chamfers (45 deg, top and bottom): sun/ring teeth, planets, ring outside, sun bore
    chamfer=0.3, planet_chamfer=0.3, ring_od_chamfer=0.3, sun_bore_chamfer=0.3,
    # captured print-in-place pin in every planet (fixed-carrier drive) + carrier plate
    planet_pins=False, pin_d=2.0, pin_gap=0.15, pin_v=0.4, pin_collar=0.8, carrier_t=2.0, carrier_fit=0.1,
    # external teeth on the ring and a gear train of bearings A -> B -> C
    ext_teeth=False, ext_module=0.6, ext_z_auto=True, ext_z=30, ext_helix="Herringbone", ext_beta=20.0,
    train="Single", ratio_ab=0.0, ratio_bc=0.0, B_OD=31.7, B_ID=18.0, C_OD=31.7, C_ID=18.0, train_angle=0.0,
)
# FreeCAD-only / mesh extras: SunBoreFlat=0.4 (D-flat, fraction of ID), SurfaceTolerance=0.005, MeshDeviation=0.01

# V1 defaults (kept so the original FreeCAD export stays a regression reference)
DEFAULTS_V1 = dict(
    DEFAULTS, ID=22.0, N=24, Zs=56, Zr=64, expansion=0.15, root_clear=0.15, tip_land=0.1, min_module=0.4,
)
# V2 defaults (FreeCAD reference export build/freecad/..._S31P4x14R39_b30_e0.1.stl)
DEFAULTS_V2 = dict(DEFAULTS, root_clear=0.1)
