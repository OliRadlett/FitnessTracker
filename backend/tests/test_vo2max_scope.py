"""The VO2max classification must travel with the population it came from.

The bands are not age or sex adjusted, so a bare label like "Average" reads as a
claim about the athlete. The scope string existed but nothing read it, which
meant the API returned the label alone. It is now a required response field, and
this test stops it quietly becoming optional again.
"""

import pytest
from pydantic import ValidationError

from app.schemas.cycling import Vo2maxResponse


def test_vo2max_response_requires_the_classification_scope():
    with pytest.raises(ValidationError):
        Vo2maxResponse(
            vo2max=50.0,
            confidence=0.7,
            method="test",
            classification="Average",
            all_estimates=[],
        )
