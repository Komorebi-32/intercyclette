"""
Intercyclette application package.

The project ships as a static site; the legacy Flask app under app/routes.py is
optional. `create_app` is exposed lazily so importing this package (e.g. by the
static-data generation scripts) does NOT pull in Flask. The Flask dependency is
only loaded when `create_app` is actually accessed.
"""

__all__ = ["create_app"]


def __getattr__(name):
    """
    Lazily resolve `create_app` to avoid importing Flask at package import time.

    Args:
        name: Attribute name being accessed on the `app` package.

    Returns:
        The `create_app` factory from app.routes when name == "create_app".

    Raises:
        AttributeError: For any other attribute name.
    """
    if name == "create_app":
        from app.routes import create_app

        return create_app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
