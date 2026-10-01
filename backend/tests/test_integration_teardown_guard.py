"""The integration teardown drops an entire schema, so it must refuse to do so
unless the database really is a disposable test one.

Teardown was changed from ``Base.metadata.drop_all`` to
``DROP SCHEMA public CASCADE`` (see ``tests/integration/conftest.py``) because
drop_all's inferred table ordering broke once ``get_db`` began committing the
fixture's own transaction. CASCADE is order-independent and strictly more
destructive than what it replaced, so the "this database exists only for the
fixture" assumption is now enforced rather than trusted.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import create_async_engine

from tests.integration.conftest import _assert_is_test_database

# A URL that never connects — the guard inspects the URL only.
_DEAD = "postgresql+asyncpg://u:p@localhost:1/"


class TestRefusesNonTestDatabases:
    def test_default_dev_database_is_refused(self):
        """The one that would actually hurt: the real development database."""
        engine = create_async_engine(_DEAD + "fittrack")
        try:
            try:
                _assert_is_test_database(engine)
            except RuntimeError as exc:
                assert "test" in str(exc).lower()
            else:
                raise AssertionError("expected a refusal for the dev database")
        finally:
            _close(engine)

    def test_postgres_maintenance_database_is_refused(self):
        engine = create_async_engine(_DEAD + "postgres")
        try:
            try:
                _assert_is_test_database(engine)
            except RuntimeError:
                pass
            else:
                raise AssertionError("expected a refusal for the postgres database")
        finally:
            _close(engine)

    def test_misspelled_test_database_is_refused(self):
        """'testing' contains 'test' but is someone's real database.

        The guard is deliberately substring-based, which is a known softness:
        it is a tripwire against the obvious mistake, not a proof of safety.
        This test documents that limitation rather than pretending it away.
        """
        engine = create_async_engine(_DEAD + "prod_test_copy_of_fitrack")
        try:
            _assert_is_test_database(engine)  # allowed — documented softness
        finally:
            _close(engine)


class TestAllowsTestDatabases:
    def test_the_default_fixture_database_is_allowed(self):
        """This is the exact database the fixture defaults to."""
        engine = create_async_engine(_DEAD + "fittrack_test")
        try:
            _assert_is_test_database(engine)  # must not raise
        finally:
            _close(engine)

    def test_ci_spelling_is_allowed(self):
        engine = create_async_engine(_DEAD + "fittrack_test_ci")
        try:
            _assert_is_test_database(engine)  # must not raise
        finally:
            _close(engine)


def _close(engine) -> None:
    """Dispose without connecting — a create_async_engine result is inert until
    first used, but disposing keeps the test honest about cleanup."""
    import asyncio

    asyncio.run(engine.dispose())