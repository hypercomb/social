"""A numba stand-in.

This machine's Application Control policy blocks numba's unsigned native
extension (`_typeconv.pyd`), so `import numba` fails and takes librosa — and
therefore Chatterbox — down with it. Nothing in the text-to-speech path needs
numba to be *fast*; it needs librosa to *import*. So: the decorators become
pass-throughs and the type names become their numpy equivalents.

The one thing that cannot be faked is `guvectorize`, whose decorated functions
write into an out-parameter and are called as ufuncs. Those raise loudly rather
than returning something quietly wrong — none of them are on the speech path.
"""

import numpy as np

__version__ = "0.0.0+shim"


def _passthrough(*args, **kwargs):
    # Handles both `@jit` and `@jit(nopython=True)`.
    if len(args) == 1 and not kwargs and callable(args[0]):
        return args[0]
    return lambda fn: fn


jit = njit = stencil = vectorize = generated_jit = _passthrough
prange = range


def guvectorize(*args, **kwargs):
    def wrap(fn):
        def blocked(*a, **k):
            raise NotImplementedError(
                f"numba.guvectorize function {fn.__name__!r} was called, but numba is "
                "shimmed out on this machine (Application Control blocks its native "
                "extension). It is not on the speech path — if you need it, that "
                "assumption no longer holds."
            )

        blocked.__name__ = fn.__name__
        blocked.__doc__ = fn.__doc__
        return blocked

    return wrap


boolean = np.bool_
int8, int16, int32, int64 = np.int8, np.int16, np.int32, np.int64
uint8, uint16, uint32, uint64 = np.uint8, np.uint16, np.uint32, np.uint64
float32, float64 = np.float32, np.float64
complex64, complex128 = np.complex64, np.complex128
intp, uintp = np.intp, np.uintp
void = None


class _Types:
    boolean = np.bool_
    int32, int64 = np.int32, np.int64
    uint32, uint64 = np.uint32, np.uint64
    float32, float64 = np.float32, np.float64
    complex64, complex128 = np.complex64, np.complex128


types = _Types()
