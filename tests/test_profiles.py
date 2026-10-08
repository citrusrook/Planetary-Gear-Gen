"""Rack-envelope generator matches analytic involute; fixtures stay in sync."""
import json, math, os
import numpy as np
import pb_math as pm
from defaults import DEFAULTS

HERE = os.path.dirname(os.path.abspath(__file__))


def test_envelope_matches_involute():
    Z, m, al = 20, 1.0, math.radians(20)
    r, t, rf, ra = pm.rack_envelope(Z, m, al, 0.0, 0.25, 0.0, 11.0, 0.05)
    rb = 10 * math.cos(al)
    errs = [(ti - (math.pi / (2 * Z) + pm.inv(al) - pm.inv(math.acos(rb / ri)))) * ri
            for ri, ti in zip(r, t) if ri > rb * 1.01]
    assert max(abs(e) for e in errs) < 1e-5
    assert abs(rf - 8.75) < 1e-9


def test_fixture_default_profiles():
    """Golden data for porting (e.g. to JS). Regenerate with tools/make_fixtures.py if math changes on purpose."""
    fx = json.load(open(os.path.join(HERE, "..", "fixtures", "default_profiles.json")))
    g = pm.derive(DEFAULTS); prof = pm.build_profiles(DEFAULTS, g)
    for k in ("planet", "sun", "ring"):
        assert np.allclose(prof[k]["r"], fx["profiles"][k]["r"], atol=1e-9)
        assert np.allclose(prof[k]["t"], fx["profiles"][k]["t"], atol=1e-6)
