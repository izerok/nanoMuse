"""Fork-only: the recommended model of each lane, set from the operator's page instead
of the environment — in force at once, kept across restarts, back to the environment's
picks on reset."""

from __future__ import annotations

from test_accounts import auth, make
from test_cloud import sign_up

from nanomuse_cloud.config import ModelSpec
from nanomuse_cloud.service import Cloud

ADMIN = {"X-Admin-Token": "admin"}

A = ModelSpec(
    id="model-a",
    name="A",
    upstream="a",
    for_=("chat", "gui"),
    recommended=True,
    recommended_for=("chat", "gui"),
)
B = ModelSpec(id="model-b", name="B", upstream="b", for_=("chat", "gui"))
PIC = ModelSpec(id="pic-1", name="Pic", upstream="pic", kind="image")


def menu():
    return make(models=(A, B, PIC))


async def test_defaults_come_from_the_environment_and_need_the_admin_token():
    app, client, sender, up, cloud, settings = menu()
    r = await client.get("/v1/admin/recommended", headers=ADMIN)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["recommended"] == {"chat": "model-a", "gui": "model-a"}
    assert out["defaults"] == {"chat": "model-a", "gui": "model-a"}
    assert out["stored"] is False and out["updated_at"] is None
    assert [m["id"] for m in out["models"]] == ["model-a", "model-b", "pic-1"]
    assert (await client.get("/v1/admin/recommended")).status_code == 401


async def test_put_changes_the_served_menu_at_once():
    app, client, sender, up, cloud, settings = menu()
    r = await client.put("/v1/admin/recommended", headers=ADMIN, json={"chat": "model-b"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["recommended"] == {"chat": "model-b", "gui": "model-a"}
    assert out["stored"] is True and out["updated_at"]
    # the menu the apps read carries the new pick, with no restart
    me_key = (await sign_up(client, sender, "13800138000", "pixel"))["api_key"]
    r = await client.get("/v1/models", headers=auth(me_key))
    assert r.status_code == 200, r.text
    shown = {m["id"]: m["nanomuse"] for m in r.json()["data"]}
    assert shown["model-b"]["recommended_for"] == ["chat"]
    assert shown["model-a"]["recommended_for"] == ["gui"]
    by_id = {m.id: m for m in cloud.s.models}
    assert by_id["model-b"].recommended_for == ("chat",)
    assert by_id["model-a"].recommended_for == ("gui",)


async def test_put_rejects_picks_that_are_not_chat_models_for_the_lane():
    app, client, sender, up, cloud, settings = menu()
    r = await client.put("/v1/admin/recommended", headers=ADMIN, json={"chat": "no-such-model"})
    assert r.status_code == 400, r.text
    r = await client.put("/v1/admin/recommended", headers=ADMIN, json={"chat": "pic-1"})
    assert r.status_code == 400, r.text
    r = await client.put("/v1/admin/recommended", headers=ADMIN, json={"bogus": "model-b"})
    assert r.status_code == 200, r.text
    assert r.json()["recommended"] == {"chat": "model-a", "gui": "model-a"}


async def test_reset_returns_to_the_environment_and_a_restart_keeps_the_pick():
    app, client, sender, up, cloud, settings = menu()
    r = await client.put("/v1/admin/recommended", headers=ADMIN, json={"chat": "model-b", "gui": "model-b"})
    assert r.status_code == 200, r.text
    assert r.json()["recommended"] == {"chat": "model-b", "gui": "model-b"}
    # a new relay process over the same database serves the stored pick
    again = Cloud(settings, cloud.db, sender)
    assert again.admin_recommended()["recommended"] == {"chat": "model-b", "gui": "model-b"}
    assert again.admin_recommended()["stored"] is True
    r = await client.put("/v1/admin/recommended", headers=ADMIN, json={"reset": True})
    assert r.status_code == 200, r.text
    assert r.json()["recommended"] == {"chat": "model-a", "gui": "model-a"}
    assert r.json()["stored"] is False
