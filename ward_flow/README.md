# Ward Flow: hospital patient-flow board

Plain HTML, CSS and JavaScript. No server, no build step, no API keys.

## Run it
Double-click `index.html`. (Fonts load from Google Fonts when online; the site falls back to system fonts offline.)

## Pages
| Page | What it answers |
|---|---|
| Today's board | Where patients wait, by department, against targets, with a date scrubber and replay |
| Alerts | Which departments drifted from their own normal (wait, volume, over-target share, walk-outs) |
| Look at first | Ranked queue: cost (patient-minutes) x certainty, with an explanation panel for every item |
| Forecast | Next 14 days of visits and expected 1h+ waits by department, with method back-test |
| Test turnaround | Diagnostic-test times, slow results, and whether urgent tests are really faster |
| Predict a wait | Live model estimate with 80% range and what-if factor effects |
| Model and data | Metrics on held-out months, calibration, data checks, limits |
| Targets | Editable wait targets and test time limits (assumptions) |

## Model (trained from scratch on the provided data only)
* Gradient-boosted trees (scikit-learn) for mean wait, 10%/90% quantiles and P(wait >= 60 min).
* Time-based split: train Jan-Aug, tune Sep-Oct, test Nov-Dec 2025. Arrival-time features only.
* Trees are exported to JSON and evaluated in the browser (`js/engine.js`); parity with Python verified.
* Honest result: triage level explains almost everything; the model is ~0.01 min better than a triage-by-department average.

## Rebuild the data file (optional)
Only needed if you change the model or the CSVs. The website itself needs no Python.
```
pip install -r requirements.txt
python pipeline/build_data.py
```
This reads `dataset/*.csv` and rewrites `data/data.js`.

Synthetic educational data, not real records, not for clinical use. No API keys, pretrained models or external data.
