# Ward Flow

**A hospital patient-flow board that tests its own data.**

Ward Flow turns four linked tables (8,000 visits, 2,000 patients, 12 departments, 5,000 diagnostic tests, all of 2025) into a live board with alerts, forecasts and a wait-time predictor. A dedicated page, **Dataset X-ray**, audits the data itself: what really drives a wait, whether capacity or fairness matter, how patients return, and where the tables contradict each other.

Plain HTML, CSS and JavaScript. No server, no build step, no API keys, no pretrained models, no external data.

## Run it

Double-click `index.html`. Fonts load from Google Fonts when online and fall back to system fonts offline.

## Pages

| Page | What it answers |
|---|---|
| Today's board | Where patients wait, by department, against targets, with a date scrubber and replay |
| Alerts | Which departments drifted from their own normal (wait, volume, over-target share, walk-outs) |
| Look at first | Ranked queue: cost (patient-minutes) x certainty, with an explanation for every item |
| Forecast | Next 14 days of visits and expected 1h+ waits by department, with a method back-test |
| Test turnaround | Diagnostic-test times, slow results, and whether urgent tests are really faster |
| Predict a wait | Live model estimate with an 80% range and what-if factor effects |
| Model and data | Metrics on held-out months, calibration, data checks, limits |
| Targets | Editable wait targets and test time limits (assumptions) |
| **Dataset X-ray** | What explains a wait, capacity reality check, fairness audit, patient journeys, data contradictions |

## How the data is used

| Table | Used for |
|---|---|
| `encounters.csv` | Wait, service and discharge times; triage; outcomes; model target and features |
| `patients.csv` | Age and chronic condition as model features; sex, insurance and home area in the fairness audit; patient journeys and returns |
| `departments.csv` | Department identity, staff, beds and stated daily capacity for the capacity reality check |
| `diagnostic_tests.csv` | Turnaround analysis, urgent vs routine comparison, and a check on whether tests can be linked to visits |

## Model

Trained from scratch on the provided data only.

* Gradient-boosted trees (scikit-learn) for mean wait, 10% and 90% quantiles, and P(wait >= 60 min).
* Time-based split: train Jan-Aug, tune Sep-Oct, test Nov-Dec 2025.
* Features are known at arrival time only (triage, department, visit type, hour, weekday, age, chronic condition, patients already waiting), so there is no leakage.
* Trees are exported to JSON and evaluated in the browser (`js/engine.js`); parity with Python is verified.
* Compared against baselines: overall average, triage average, triage-by-department average, and ridge regression.

**Honest result:** triage explains almost everything, and the model is only about 0.01 min better than a triage-by-department average. The Dataset X-ray page shows why.

## Dataset X-ray: findings

| Question | Result |
|---|---|
| What explains a wait? | Triage alone explains 47% of the variation. Department adds 5%. Arrival time and patient profile add nothing. 48% is unexplained by anything in the tables. |
| Is it capacity? | About 0.7% of stated daily capacity is used. 94% of patients arrive to an empty department queue and still wait about 52 minutes. Wait is unrelated to staff or beds. Waits are process delays, not crowding. |
| Is it fair? | After adjusting for triage and department, no group (insurance, sex, age band, chronic condition, home area) waits measurably longer. All five F-tests are non-significant. |
| Do patients return? | About 28% of visits are followed by another within 30 days (censored at year end). A long wait does not change that (p = 0.28). The busiest 5% of patients make up only 10.5% of visits. |
| Is the data consistent? | 9 checks, 4 high severity. For example, all 242 "Left before care" visits have full service records, 544 of 657 Pediatrics visits are adults, and only 19 of 5,000 tests fall within 24 hours of their visit. |
| Do the findings survive the bad rows? | Removing the first two flagged groups moves no triage average by more than 0.68 min. |

Methods: nested linear models with adjusted R-squared, F-tests for incremental fit, Spearman correlations, chi-square tests, and a 30-day return analysis that drops visits too late in the year to observe a return.

## Project structure

```
ward_flow/
  index.html            entry point
  css/style.css         styles (light and dark)
  js/
    engine.js           model evaluation, alerts, queue ranking, forecasts
    charts.js           small SVG chart helpers
    app.js              pages and interaction
    insights.js         Dataset X-ray page
  data/
    data.js             encounters, models and metrics (built by build_data.py)
    insights.js         X-ray results (built by deep_dive.py)
  dataset/              the four source CSVs
  pipeline/
    build_data.py       trains models, runs data checks, writes data/data.js
    deep_dive.py        runs the X-ray analysis, writes data/insights.js
  requirements.txt
```

## Rebuild the data files (optional)

Only needed if you change the model, the analysis or the CSVs. The website itself needs no Python.

```
pip install -r requirements.txt
python pipeline/build_data.py
python pipeline/deep_dive.py
```

## Limits

* The data is synthetic and educational. It is not real patient records and not for clinical use.
* Tests cannot be reliably linked to visits (timestamps do not line up), so they are analysed as their own stream.
* Chronic condition is blank for 37% of patients and is treated as "none". Whether that means none or not recorded is unknown.
* Stated department capacities are far above actual volumes, so capacity conclusions describe this dataset and may not hold elsewhere.
* Results report associations in one year of data, not causes.
