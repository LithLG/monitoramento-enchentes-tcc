import pytest

from app.tree import Decision, LevelRange, RainClass, Status, Thresholds, TreeInput, classify, explain, level_limits

V1 = Thresholds(id=1, attention_fraction=0.667, risk_fraction=1.000, soil_saturated_index=0.8, level_hysteresis_mm=2.0, dry_depth_mm=1.0)
V2 = Thresholds(id=2, attention_fraction=0.647, risk_fraction=0.824, soil_saturated_index=0.8, level_hysteresis_mm=2.0, dry_depth_mm=1.0)
MODEL_BANKFULL_MM = 25.5


def reading(depth=None, level_range=LevelRange.INSIDE, rain=RainClass.DRY, soil=0.1, previous=None, bankfull=30.0):
    return TreeInput(
        level_range=level_range,
        level_depth_mm=depth,
        bankfull_depth_mm=bankfull,
        rain_class=rain,
        soil_index=soil,
        previous_status=previous,
    )


@pytest.mark.parametrize(
    ("depth", "status", "rule"),
    [
        (19.9, Status.NORMAL, "NIVEL_NORMAL"),
        (20.0, Status.NORMAL, "NIVEL_NORMAL"),
        (20.01, Status.ATENCAO, "NIVEL_ATENCAO"),
        (29.9, Status.ATENCAO, "NIVEL_ATENCAO"),
        (30.0, Status.RISCO, "TRANSBORDOU"),
    ],
)
def test_class_by_level_inside_sensor_range(depth, status, rule):
    decision = classify(reading(depth), V1)
    assert (decision.status, decision.rule) == (status, rule)


@pytest.mark.parametrize(
    ("depth", "status", "rule"),
    [
        (12.0, Status.NORMAL, "NIVEL_NORMAL"),
        (16.4, Status.NORMAL, "NIVEL_NORMAL"),
        (16.5, Status.ATENCAO, "NIVEL_ATENCAO"),
        (20.9, Status.ATENCAO, "NIVEL_ATENCAO"),
        (21.1, Status.RISCO, "NIVEL_RISCO"),
        (25.4, Status.RISCO, "NIVEL_RISCO"),
        (25.5, Status.RISCO, "TRANSBORDOU"),
    ],
)
def test_risk_comes_before_the_river_overflows(depth, status, rule):
    decision = classify(reading(depth, bankfull=MODEL_BANKFULL_MM), V2)
    assert (decision.status, decision.rule) == (status, rule)


def test_water_above_sensor_range_overflows():
    decision = classify(reading(level_range=LevelRange.ABOVE), V1)
    assert (decision.status, decision.rule) == (Status.RISCO, "TRANSBORDOU")


def test_v2_hysteresis_holds_risk_until_19_mm():
    held = classify(reading(19.1, previous=Status.RISCO, bankfull=MODEL_BANKFULL_MM), V2)
    released = classify(reading(18.9, previous=Status.RISCO, bankfull=MODEL_BANKFULL_MM), V2)
    assert (held.status, released.status) == (Status.RISCO, Status.ATENCAO)


def test_water_below_sensor_range_is_a_dry_river():
    decision = classify(reading(level_range=LevelRange.BELOW), V1)
    assert (decision.status, decision.rule) == (Status.NORMAL, "RIO_SECO")


def test_almost_no_water_is_a_dry_river():
    decision = classify(reading(0.5), V1)
    assert (decision.status, decision.rule) == (Status.NORMAL, "RIO_SECO")


def test_low_but_present_water_is_normal():
    decision = classify(reading(10.0), V1)
    assert (decision.status, decision.rule) == (Status.NORMAL, "NIVEL_NORMAL")


def test_storm_signs_on_a_dry_river_only_warn():
    decision = classify(reading(level_range=LevelRange.BELOW, rain=RainClass.RAIN, soil=0.9), V1)
    assert (decision.status, decision.rule) == (Status.NORMAL, "AVISO_SOLO_CHUVA")


def test_hysteresis_holds_risk_inside_band():
    decision = classify(reading(29.0, previous=Status.RISCO), V1)
    assert (decision.status, decision.rule) == (Status.RISCO, "HISTERESE_MANTEM_RISCO")


def test_hysteresis_releases_when_depth_leaves_band():
    decision = classify(reading(27.5, previous=Status.RISCO), V1)
    assert (decision.status, decision.rule) == (Status.ATENCAO, "NIVEL_ATENCAO")


def test_fast_drop_from_risk_stops_in_attention_band():
    decision = classify(reading(19.0, previous=Status.RISCO), V1)
    assert (decision.status, decision.rule) == (Status.ATENCAO, "HISTERESE_MANTEM_ATENCAO")


def test_rise_has_no_delay():
    decision = classify(reading(20.1, previous=Status.NORMAL), V1)
    assert decision.status is Status.ATENCAO


def test_first_reading_uses_only_level():
    decision = classify(reading(19.0, previous=None), V1)
    assert (decision.status, decision.rule) == (Status.NORMAL, "NIVEL_NORMAL")


def test_hysteresis_does_not_apply_below_sensor_range():
    decision = classify(reading(level_range=LevelRange.BELOW, previous=Status.RISCO), V1)
    assert decision.status is Status.NORMAL


def test_saturated_soil_and_heavy_rain_escalate_attention_to_risk():
    decision = classify(reading(22.5, rain=RainClass.HEAVY, soil=0.85), V1)
    assert (decision.status, decision.rule) == (Status.RISCO, "ESCALADA_SOLO_CHUVA")


def test_escalation_needs_rain():
    decision = classify(reading(22.5, rain=RainClass.DRY, soil=0.95), V1)
    assert (decision.status, decision.rule) == (Status.ATENCAO, "NIVEL_ATENCAO")


def test_any_rain_counts_because_the_plate_only_tells_wet_or_dry():
    decision = classify(reading(22.5, rain=RainClass.RAIN, soil=0.95), V1)
    assert (decision.status, decision.rule) == (Status.RISCO, "ESCALADA_SOLO_CHUVA")


def test_escalation_needs_saturated_soil():
    decision = classify(reading(22.5, rain=RainClass.HEAVY, soil=0.79), V1)
    assert decision.status is Status.ATENCAO


def test_rain_and_soil_never_lower_the_class():
    decision = classify(reading(31.0, rain=RainClass.DRY, soil=0.0), V1)
    assert decision.status is Status.RISCO


def test_rain_and_wet_soil_on_a_normal_river_only_warn():
    decision = classify(reading(10.0, rain=RainClass.RAIN, soil=0.9), V1)
    assert (decision.status, decision.rule) == (Status.NORMAL, "AVISO_SOLO_CHUVA")


def test_no_warning_without_rain():
    decision = classify(reading(10.0, rain=RainClass.DRY, soil=1.0), V1)
    assert (decision.status, decision.rule) == (Status.NORMAL, "NIVEL_NORMAL")


def test_no_warning_with_dry_soil():
    decision = classify(reading(10.0, rain=RainClass.RAIN, soil=0.3), V1)
    assert (decision.status, decision.rule) == (Status.NORMAL, "NIVEL_NORMAL")


def test_escalation_also_applies_to_class_held_by_hysteresis():
    decision = classify(reading(19.0, rain=RainClass.HEAVY, soil=0.9, previous=Status.ATENCAO), V1)
    assert (decision.status, decision.rule) == (Status.RISCO, "ESCALADA_SOLO_CHUVA")


def test_explain_shows_each_step_of_the_path():
    steps = explain(reading(15.0, rain=RainClass.RAIN, soil=0.9, previous=Status.ATENCAO, bankfull=MODEL_BANKFULL_MM), V2)
    assert steps.by_level == Decision(Status.NORMAL, "NIVEL_NORMAL")
    assert steps.previous_was_higher
    assert steps.after_hysteresis == Decision(Status.ATENCAO, "HISTERESE_MANTEM_ATENCAO")
    assert (steps.is_raining, steps.soil_is_saturated) == (True, True)
    assert steps.final == Decision(Status.RISCO, "ESCALADA_SOLO_CHUVA")


def test_explain_ends_with_the_same_decision_as_classify():
    for depth in (0.5, 12.0, 16.5, 18.0, 21.0, 24.0, 25.5):
        for previous in (None, Status.NORMAL, Status.ATENCAO, Status.RISCO):
            for rain, soil in ((RainClass.DRY, 0.1), (RainClass.RAIN, 0.9)):
                one = reading(depth, rain=rain, soil=soil, previous=previous, bankfull=MODEL_BANKFULL_MM)
                assert explain(one, V2).final == classify(one, V2)


def test_previous_class_is_not_higher_when_the_water_is_outside_the_sensor_range():
    steps = explain(reading(level_range=LevelRange.ABOVE, previous=Status.RISCO), V1)
    assert not steps.previous_was_higher


def test_level_limits_of_the_model_in_thirds():
    limits = level_limits(MODEL_BANKFULL_MM, V2)
    assert (limits.attention_mm, limits.risk_mm, limits.bankfull_mm) == (16.4985, 21.012, 25.5)
    assert (limits.attention_exit_mm, limits.risk_exit_mm, limits.dry_mm) == (14.4985, 19.012, 1.0)
