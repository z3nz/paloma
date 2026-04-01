from decimal import Decimal, getcontext

# Set the precision to 67 digits
getcontext().prec = 67

# Calculate Pi using a formula from the decimal documentation
def calculate_decimal_pi():
    """Compute Pi to the current precision."""
    three = Decimal(3)
    lasts, t, s, n, na, d, da = 0, three, 3, 1, 0, 0, 24
    while s != lasts:
        lasts = s
        n, na = n + na, na + 8
        d, da = d + da, da + 32
        t = (t * n) / d
        s += t
    return +s

pi_high_prec = calculate_decimal_pi()
print(pi_high_prec)