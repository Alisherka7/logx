# Excluded by the default configuration (tests/**): must not produce findings.
def test_health():
    print("debug output in a test")
    try:
        pass
    except Exception:
        pass
