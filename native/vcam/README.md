# Onstage Camera driver

`UnityCaptureFilter64.dll` and `UnityCaptureFilter32.dll` are the prebuilt DirectShow virtual camera
from [UnityCapture](https://github.com/schellingb/UnityCapture) (MIT licence, see `LICENSE.txt`).
The Onstage installer registers them with Windows under the name "Onstage Camera".

To register by hand from an administrator prompt (for running from source):

```
regsvr32 UnityCaptureFilter64.dll "/i:UnityCaptureName=Onstage Camera"
regsvr32 UnityCaptureFilter32.dll "/i:UnityCaptureName=Onstage Camera"
```

To remove: `regsvr32 /u UnityCaptureFilter64.dll` and the same for the 32-bit file.
