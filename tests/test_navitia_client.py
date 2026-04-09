"""
Unit tests for app.navitia.client.

All HTTP calls are mocked — no real network access occurs.
"""

import os
import pytest
from unittest.mock import patch, MagicMock

from app.navitia.client import (
    NavitiaConfig,
    NavitiaError,
    load_config_from_env,
    build_journey_url,
    fetch_journey,
    fetch_outbound_journeys,
    fetch_return_journeys,
)
from app.constants import NAVITIA_BASE_URL, NAVITIA_DEFAULT_HOUR, NAVITIA_RETURN_HOUR


# ---------------------------------------------------------------------------
# load_config_from_env
# ---------------------------------------------------------------------------

class TestLoadConfigFromEnv:
    def test_returns_config_when_token_set(self, monkeypatch):
        monkeypatch.setenv("NAVITIA_TOKEN", "mytoken123")
        config = load_config_from_env()
        assert config.token == "mytoken123"

    def test_raises_when_token_absent(self, monkeypatch):
        monkeypatch.delenv("NAVITIA_TOKEN", raising=False)
        with pytest.raises(RuntimeError, match="NAVITIA_TOKEN"):
            load_config_from_env()

    def test_raises_when_token_empty(self, monkeypatch):
        monkeypatch.setenv("NAVITIA_TOKEN", "   ")
        with pytest.raises(RuntimeError, match="NAVITIA_TOKEN"):
            load_config_from_env()

    def test_base_url_defaults_to_constant(self, monkeypatch):
        monkeypatch.setenv("NAVITIA_TOKEN", "tok")
        config = load_config_from_env()
        assert config.base_url == NAVITIA_BASE_URL


# ---------------------------------------------------------------------------
# build_journey_url
# ---------------------------------------------------------------------------

class TestBuildJourneyUrl:
    def _config(self):
        return NavitiaConfig(token="tok", base_url="https://api.navitia.io/v1")

    def test_contains_from_stop_area(self):
        url = build_journey_url(self._config(), "87313759", "87123456", "20260409T080000")
        assert "from=stop_area:SNCF:87313759" in url

    def test_contains_to_stop_area(self):
        url = build_journey_url(self._config(), "87313759", "87123456", "20260409T080000")
        assert "to=stop_area:SNCF:87123456" in url

    def test_contains_datetime(self):
        url = build_journey_url(self._config(), "87313759", "87123456", "20260409T080000")
        assert "datetime=20260409T080000" in url

    def test_uses_base_url(self):
        url = build_journey_url(self._config(), "87313759", "87123456", "20260409T080000")
        assert url.startswith("https://api.navitia.io/v1")


# ---------------------------------------------------------------------------
# fetch_journey
# ---------------------------------------------------------------------------

class TestFetchJourney:
    def _config(self):
        return NavitiaConfig(token="tok")

    def _mock_response(self, json_data: dict, status_code: int = 200):
        mock = MagicMock()
        mock.json.return_value = json_data
        mock.status_code = status_code
        mock.raise_for_status = MagicMock()
        return mock

    def test_returns_json_dict_on_success(self):
        expected = {"journeys": []}
        with patch("requests.get") as mock_get:
            mock_get.return_value = self._mock_response(expected)
            result = fetch_journey(self._config(), "87313759", "87123456", "20260409T080000")
        assert result == expected

    def test_uses_basic_auth_with_token(self):
        with patch("requests.get") as mock_get:
            mock_get.return_value = self._mock_response({})
            fetch_journey(self._config(), "87313759", "87123456", "20260409T080000")
            _, kwargs = mock_get.call_args
            assert kwargs["auth"] == ("tok", "")

    def test_raises_navitia_error_on_http_error(self):
        import requests as req
        with patch("requests.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.status_code = 401
            mock_resp.raise_for_status.side_effect = req.exceptions.HTTPError(
                response=mock_resp
            )
            mock_get.return_value = mock_resp
            with pytest.raises(NavitiaError, match="HTTP error"):
                fetch_journey(self._config(), "87313759", "87123456", "20260409T080000")

    def test_raises_navitia_error_on_timeout(self):
        import requests as req
        with patch("requests.get") as mock_get:
            mock_get.side_effect = req.exceptions.Timeout()
            with pytest.raises(NavitiaError, match="timed out"):
                fetch_journey(self._config(), "87313759", "87123456", "20260409T080000")


# ---------------------------------------------------------------------------
# fetch_outbound_journeys
# ---------------------------------------------------------------------------

class TestFetchOutboundJourneys:
    def _config(self):
        return NavitiaConfig(token="tok")

    def test_makes_one_call_per_candidate(self):
        uics = ["87001", "87002", "87003"]
        with patch("app.navitia.client.fetch_journey") as mock_fj:
            mock_fj.return_value = {"journeys": []}
            result = fetch_outbound_journeys(self._config(), "87000", uics, "20260409")
        assert mock_fj.call_count == 3
        assert len(result) == 3

    def test_failed_call_returns_none_in_list(self):
        uics = ["87001", "87002"]
        def side_effect(config, from_uic, to_uic, dt):
            if to_uic == "87002":
                raise NavitiaError("fail")
            return {"journeys": []}
        with patch("app.navitia.client.fetch_journey", side_effect=side_effect):
            result = fetch_outbound_journeys(self._config(), "87000", uics, "20260409")
        assert result[0] is not None
        assert result[1] is None

    def test_datetime_uses_default_hour(self):
        with patch("app.navitia.client.fetch_journey") as mock_fj:
            mock_fj.return_value = {}
            fetch_outbound_journeys(self._config(), "87000", ["87001"], "20260409")
            _, kwargs = mock_fj.call_args
            # Positional args: config, from_uic, to_uic, datetime_str
            datetime_str = mock_fj.call_args[0][3]
            assert f"T{NAVITIA_DEFAULT_HOUR:02d}" in datetime_str

    def test_caps_at_outbound_candidate_count(self):
        uics = ["87001", "87002", "87003", "87004", "87005"]
        with patch("app.navitia.client.fetch_journey") as mock_fj:
            mock_fj.return_value = {}
            fetch_outbound_journeys(self._config(), "87000", uics, "20260409")
        assert mock_fj.call_count == 3  # OUTBOUND_CANDIDATE_COUNT = 3


# ---------------------------------------------------------------------------
# fetch_return_journeys
# ---------------------------------------------------------------------------

class TestFetchReturnJourneys:
    def _config(self):
        return NavitiaConfig(token="tok")

    def test_makes_one_call_per_return_uic(self):
        uics = ["87001", "87002", "87003"]
        with patch("app.navitia.client.fetch_journey") as mock_fj:
            mock_fj.return_value = {"journeys": []}
            result = fetch_return_journeys(self._config(), uics, "87000", "20260412")
        assert mock_fj.call_count == 3
        assert len(result) == 3

    def test_datetime_uses_return_hour(self):
        with patch("app.navitia.client.fetch_journey") as mock_fj:
            mock_fj.return_value = {}
            fetch_return_journeys(self._config(), ["87001"], "87000", "20260412")
            datetime_str = mock_fj.call_args[0][3]
            assert f"T{NAVITIA_RETURN_HOUR:02d}" in datetime_str

    def test_from_and_to_swapped_vs_outbound(self):
        """Return journey calls fetch_journey with (return_uic, departure_uic)."""
        with patch("app.navitia.client.fetch_journey") as mock_fj:
            mock_fj.return_value = {}
            fetch_return_journeys(self._config(), ["87001"], "87000", "20260412")
            args = mock_fj.call_args[0]
            # args: (config, from_uic, to_uic, datetime_str)
            assert "87001" in args[1]
            assert "87000" in args[2]
