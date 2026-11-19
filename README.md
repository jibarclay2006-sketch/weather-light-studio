# Weather Light Studio

Draw and share frame-by-frame animations for the 8 × 8 Weather Light. Open `index.html` in a current browser or visit the GitHub Pages site. The editor runs locally in the browser and saves the current project there.

- Select a color and paint pixels. Use Duplicate to edit a copy of the current frame. Trace last frame helps line up successive drawings.
- Play the loop in Grid or On light. The housing preview uses a render of the actual Weather Light enclosure. The physical diffuser and room lighting affect the result.
- Send an **Editable project** JSON file to anyone with the studio. They can load it with **Open**.
- Save a still PNG or a lossless animated PNG of the selected preview.
- Choose **For the Weather Light** to download `CustomAnimation.h`. Extract [the Arduino sketch](weather-light-animation-firmware.zip), add the header alongside `WeatherLight.ino`, and follow the included guide to upload via USB. Select **CUSTOM** with the rear Mode button.

The editor supports up to 120 frames with a duration of 80–10,000 ms per frame.
