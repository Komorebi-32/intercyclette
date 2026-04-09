"""
Intercyclette Flask application package.

Import and expose create_app for use by the WSGI server or flask CLI.
"""

from app.routes import create_app

__all__ = ["create_app"]
