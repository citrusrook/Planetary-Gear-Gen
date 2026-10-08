"""Default parameter set (pb_math 'p' dict) - matches the FreeCAD object defaults."""
DEFAULTS = dict(
    OD=31.7, ID=22.0, H=5.0,
    N=24, Zp=4, Zs=56, Zr=64,
    alpha=22.0, beta=30.0, reversals=1,
    expansion=0.15, root_clear=0.15, tip_land=0.1,
    hunting=False,
    min_planet_gap=0.3, min_wall=0.5, min_module=0.4,
    module_auto=True, module=0.5,
    shift_auto=True, shift=0.0,
    sun_bore_shape="Round", planet_bore_d=0.0, planet_bore_shape="Round",
)
# FreeCAD-only extras: EdgeChamfer=0.3, SunBoreFlat=0.4 (D-flat, fraction of ID),
# SurfaceTolerance=0.005, MeshDeviation=0.01
