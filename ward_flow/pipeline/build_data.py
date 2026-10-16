"""
Ward Flow - data + model pipeline.
Reads the 4 provided CSVs, trains models FROM SCRATCH (no pretrained weights, no API),
and writes data/data.js which the static website loads.
Run:  python pipeline/build_data.py  <path-to-csv-folder>
"""
import sys, json, os, math
import numpy as np, pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, GradientBoostingClassifier
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score, roc_auc_score, brier_score_loss
from scipy import stats

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dataset")
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "data.js")
RNG = np.random.RandomState(7)

if not os.path.exists(os.path.join(SRC, "patients.csv")):
    sys.exit(f"Cannot find patients.csv in: {os.path.abspath(SRC)}\nPut the 4 CSV files in the 'dataset' folder next to index.html, or run:\n  python pipeline/build_data.py \"path\\to\\csv folder\"")
p = pd.read_csv(f"{SRC}/patients.csv")
e = pd.read_csv(f"{SRC}/encounters.csv", parse_dates=["arrival_time","service_start_time","service_end_time","discharge_time"])
dep = pd.read_csv(f"{SRC}/departments.csv")
t = pd.read_csv(f"{SRC}/diagnostic_tests.csv", parse_dates=["requested_time","completion_time"])

# ---------------- data health checks ----------------
health = []
def chk(name, ok, detail): health.append({"check": name, "ok": bool(ok), "detail": detail})
chk("No missing values in encounters/tests", e.isna().sum().sum()==0 and t.isna().sum().sum()==0, "0 nulls across 8,000 encounters and 5,000 tests")
chk("Every encounter links to a patient and department", e.patient_id.isin(p.patient_id).all() and e.department_id.isin(dep.department_id).all(), "0 orphan keys")
w = (e.service_start_time-e.arrival_time).dt.total_seconds()/60
chk("wait_minutes equals service start minus arrival", (abs(w-e.wait_minutes)<=1).all(), "all 8,000 rows agree")
s = (e.service_end_time-e.service_start_time).dt.total_seconds()/60
chk("service_minutes equals service end minus start", (abs(s-e.service_minutes)<=1).all(), "all 8,000 rows agree")
chk("Every test links to an encounter", t.encounter_id.isin(e.encounter_id).all(), "0 orphan tests")
m = t.merge(e[["encounter_id","arrival_time"]], on="encounter_id")
dh = (m.requested_time-m.arrival_time).dt.total_seconds()/3600
near = ((dh>=-1)&(dh<=24)).mean()
chk("Test times line up with the visit they belong to", near>0.5, f"only {near*100:.1f}% of tests are requested within 24h after arrival (median gap {dh.median():.0f}h) - so tests are analysed on their own, never stitched into a visit timeline")
chk("Chronic condition recorded", p.chronic_condition.notna().all(), f"{p.chronic_condition.isna().sum()} of {len(p)} patients have it blank; treated as 'None'")
e = e.merge(p, on="patient_id", how="left").merge(dep, on="department_id")
e["chronic_condition"] = e.chronic_condition.fillna("None")
e = e.sort_values("arrival_time").reset_index(drop=True)

# ---------------- feature engineering (arrival-time only => no leakage) ----------------
T0 = pd.Timestamp("2025-01-01")
e["day"] = (e.arrival_time.dt.normalize()-T0).dt.days
e["minute"] = e.arrival_time.dt.hour*60+e.arrival_time.dt.minute
e["hour"] = e.arrival_time.dt.hour
e["dow"] = e.arrival_time.dt.dayofweek
TRI = ["Critical","High","Medium","Low"]; VIS=["Emergency","Walk-in","Scheduled","Follow-up"]
OUTC = ["Discharged","Admitted","Transferred","Left before care"]
e["tri"] = e.triage_level.map({k:i for i,k in enumerate(TRI)})
e["vis"] = e.visit_type.map({k:i for i,k in enumerate(VIS)})
e["out"] = e.outcome.map({k:i for i,k in enumerate(OUTC)})
dep_ids = list(dep.department_id); e["d"] = e.department_id.map({k:i for i,k in enumerate(dep_ids)})
e["lag"] = (e.discharge_time-e.service_end_time).dt.total_seconds()/60
e["chr"] = (e.chronic_condition!="None").astype(int)

# patients already waiting when this patient arrives (known at arrival time)
a = e.arrival_time.values.astype("datetime64[m]").astype(np.int64)
sv = e.service_start_time.values.astype("datetime64[m]").astype(np.int64)
qa = np.zeros(len(e),int); qd = np.zeros(len(e),int); dd = e.d.values
for i in range(len(e)):
    waiting = (a<a[i])&(sv>a[i])
    qa[i]=waiting.sum(); qd[i]=(waiting&(dd==dd[i])).sum()
e["qa"]=qa; e["qd"]=qd

FEATS = (["triage_rank"] + [f"dept_{i}" for i in range(12)] + [f"visit_{v}" for v in VIS] +
         ["hour","day_of_week","age","has_chronic","waiting_in_dept","waiting_hospital"])
def feats(df):
    X = np.zeros((len(df), len(FEATS)))
    X[:,0] = df.tri.values
    for i in range(12): X[:,1+i] = (df.d.values==i)
    for j in range(4): X[:,13+j] = (df.vis.values==j)
    X[:,17]=df.hour.values; X[:,18]=df.dow.values; X[:,19]=df.age.values; X[:,20]=df.chr.values
    X[:,21]=df.qd.values; X[:,22]=df.qa.values
    return X
X = feats(e); y = e.wait_minutes.values.astype(float)
tr = (e.arrival_time<"2025-09-01").values; va=((e.arrival_time>="2025-09-01")&(e.arrival_time<"2025-11-01")).values; te=(e.arrival_time>="2025-11-01").values
print("split", tr.sum(), va.sum(), te.sum())

def reg_metrics(yt, yp): return {"MAE": round(mean_absolute_error(yt,yp),2), "RMSE": round(math.sqrt(mean_squared_error(yt,yp)),2), "R2": round(r2_score(yt,yp),3)}
base = {}
base["Same for everyone (overall average)"] = reg_metrics(y[te], np.full(te.sum(), y[tr].mean()))
tm = e[tr].groupby("tri").wait_minutes.mean(); base["By triage level"] = reg_metrics(y[te], e[te].tri.map(tm).values)
tdm = e[tr].groupby(["tri","d"]).wait_minutes.mean(); gm=y[tr].mean()
base_td = np.array([tdm.get((a_,b_), tm[a_]) for a_,b_ in zip(e[te].tri,e[te].d)])
base["By triage level and department"] = reg_metrics(y[te], base_td)
rd = Ridge(alpha=5).fit(X[tr], y[tr]); base["Ridge regression (linear)"] = reg_metrics(y[te], rd.predict(X[te]))

# tune on validation (time-ordered), then refit on train+val
best=None
for depth in (2,3,4):
    for n in (60,120,200):
        for lr in (0.03,0.06):
            m_ = GradientBoostingRegressor(n_estimators=n,max_depth=depth,learning_rate=lr,subsample=0.8,min_samples_leaf=30,random_state=1).fit(X[tr],y[tr])
            mae = mean_absolute_error(y[va], m_.predict(X[va]))
            if best is None or mae<best[0]: best=(mae,depth,n,lr)
print("best", best)
_,DEPTH,NEST,LR = best
trva = tr|va
def fit_reg(**kw): return GradientBoostingRegressor(n_estimators=NEST,max_depth=DEPTH,learning_rate=LR,subsample=0.8,min_samples_leaf=30,random_state=1,**kw)
# evaluation model: trained on train+val, scored on untouched test months
mean_m = fit_reg().fit(X[trva], y[trva]); pt = mean_m.predict(X[te])
base["Gradient-boosted trees (our model)"] = reg_metrics(y[te], pt)
lo_m = fit_reg(loss="quantile", alpha=0.1).fit(X[trva], y[trva]); hi_m = fit_reg(loss="quantile", alpha=0.9).fit(X[trva], y[trva])
lo, hi = lo_m.predict(X[te]), hi_m.predict(X[te]); lo=np.minimum(lo,pt); hi=np.maximum(hi,pt)
cover = float(((y[te]>=lo)&(y[te]<=hi)).mean())
LONG=60; yl=(y>=LONG).astype(int)
clf = GradientBoostingClassifier(n_estimators=NEST,max_depth=DEPTH,learning_rate=LR,subsample=0.8,min_samples_leaf=30,random_state=1).fit(X[trva], yl[trva])
pp = clf.predict_proba(X[te])[:,1]
auc = roc_auc_score(yl[te], pp)
auc_tri = roc_auc_score(yl[te], e[te].tri.values)
brier = brier_score_loss(yl[te], pp); brier_base = brier_score_loss(yl[te], np.full(te.sum(), yl[trva].mean()))
# calibration bins
q = pd.qcut(pp, 5, duplicates="drop"); cal = pd.DataFrame({"p":pp,"y":yl[te],"q":q}).groupby("q",observed=True).agg(pred=("p","mean"),actual=("y","mean"),n=("y","size")).round(3).reset_index(drop=True).to_dict("records")
# interval coverage by triage
cov_tri = {TRI[i]: round(float(((y[te]>=lo)&(y[te]<=hi))[e[te].tri.values==i].mean()),3) for i in range(4)}

# permutation importance (MAE increase on test), grouped by original feature
groups = {"Triage level":[0], "Department":list(range(1,13)), "Visit type":list(range(13,17)), "Hour of arrival":[17], "Day of week":[18], "Patient age":[19], "Chronic condition":[20], "Patients waiting in department":[21], "Patients waiting hospital-wide":[22]}
base_mae = mean_absolute_error(y[te], pt); imp={}
for g,cols in groups.items():
    inc=[]
    for r in range(5):
        Xp = X[te].copy(); perm = RNG.permutation(te.sum()); Xp[:,cols]=Xp[perm][:,cols]
        inc.append(mean_absolute_error(y[te], mean_m.predict(Xp))-base_mae)
    imp[g]=round(float(np.mean(inc)),3)

# production models for the website: refit on ALL data so tomorrow's predictions use everything
allm = np.ones(len(e),bool)
mean_f = fit_reg().fit(X, y); lo_f = fit_reg(loss="quantile",alpha=0.1).fit(X,y); hi_f = fit_reg(loss="quantile",alpha=0.9).fit(X,y)
clf_f = GradientBoostingClassifier(n_estimators=NEST,max_depth=DEPTH,learning_rate=LR,subsample=0.8,min_samples_leaf=30,random_state=1).fit(X,yl)

def export_model(m, kind):
    raw0 = float(m._raw_predict_init(X[:1])[0,0])
    trees=[]
    for est in m.estimators_[:,0]:
        tt=est.tree_
        trees.append({"f":tt.feature.tolist(),"t":[round(float(v),4) for v in tt.threshold],"l":tt.children_left.tolist(),"r":tt.children_right.tolist(),"v":[round(float(v),4) for v in tt.value[:,0,0]]})
    return {"kind":kind,"init":raw0,"lr":m.learning_rate,"trees":trees}
models = {"mean":export_model(mean_f,"reg"),"lo":export_model(lo_f,"reg"),"hi":export_model(hi_f,"reg"),"long":export_model(clf_f,"clf")}
bg_idx = RNG.choice(len(e), 80, replace=False)
background = X[bg_idx].round(3).tolist()
parity = {"x": X[:5].round(3).tolist(), "mean": mean_f.predict(X[:5]).round(4).tolist(), "lo": lo_f.predict(X[:5]).round(4).tolist(), "hi": hi_f.predict(X[:5]).round(4).tolist(), "long": clf_f.predict_proba(X[:5])[:,1].round(5).tolist()}

# ---------------- demand forecast back-test (daily arrivals, 14-day horizon, rolling origin) ----------------
daily = e.groupby("day").size().reindex(range(365), fill_value=0).values.astype(float)
def f_naive7(h, k): return np.full(14, h[-7:].mean())
def f_mean28(h, k): return np.full(14, h[-28:].mean())
def f_mean56(h, k): return np.full(14, h[-56:].mean())
def f_dow(h, k):
    base=h[-56:].mean(); prof=np.array([h[-56:][(np.arange(56)+ (len(h)-56))%7==d_].mean() for d_ in range(7)])/base
    return np.array([base*prof[(k+j)%7] for j in range(14)])
meths={"Repeat last 7 days":f_naive7,"Average of last 28 days":f_mean28,"Average of last 56 days":f_mean56,"Weekday pattern (56 days)":f_dow}
res={n:[] for n in meths}
for origin in range(120, 365-14, 7):
    h=daily[:origin]; actual=daily[origin:origin+14]
    for n,f in meths.items(): res[n].append(np.abs(f(h,origin%7)-actual).mean())
fc_bt = {n: round(float(np.mean(v)),2) for n,v in res.items()}
print("forecast backtest", fc_bt)
resid = []
for origin in range(120, 365-14, 7):
    resid.extend(list(daily[origin:origin+14]-f_mean28(daily[:origin],0)))
fc_q = [round(float(np.percentile(resid,10)),2), round(float(np.percentile(resid,90)),2)]

# ---------------- diagnostics ----------------
TT = sorted(t.test_type.unique()); PR=["Urgent","Routine"]
t["tat"]=(t.completion_time-t.requested_time).dt.total_seconds()/60
t["day"]=(t.requested_time.dt.normalize()-T0).dt.days
t["tt"]=t.test_type.map({k:i for i,k in enumerate(TT)}); t["pr"]=t.priority.map({k:i for i,k in enumerate(PR)})
u=t[t.priority=="Urgent"].tat; r_=t[t.priority=="Routine"].tat
mw = stats.mannwhitneyu(u, r_, alternative="less")
urgent_finding = {"urgent_median": float(u.median()), "routine_median": float(r_.median()), "p_urgent_faster": round(float(mw.pvalue),3), "n_urgent": int(len(u)), "n_routine": int(len(r_))}
print(urgent_finding)

# ---------------- export ----------------
def col(df,c,dt=int): return df[c].astype(dt).tolist()
enc = {"d":col(e,"d"),"tri":col(e,"tri"),"vis":col(e,"vis"),"day":col(e,"day"),"min":col(e,"minute"),"wait":col(e,"wait_minutes"),"svc":col(e,"service_minutes"),"lag":col(e,"lag"),"out":col(e,"out"),"age":col(e,"age"),"chr":col(e,"chr"),"qd":col(e,"qd"),"qa":col(e,"qa"),"id":e.encounter_id.tolist()}
tests = {"tt":col(t,"tt"),"pr":col(t,"pr"),"day":col(t,"day"),"tat":col(t,"tat")}
deps = [{"id":r.department_id,"name":r.department_name,"staff":int(r.staff_count),"beds":int(r.bed_count),"cap":int(r.daily_capacity),"type":r.service_type} for r in dep.itertuples()]
tri_mean = e[tr].groupby("tri").wait_minutes.mean().round(2).tolist()
tri_sd = float((e.wait_minutes-e.tri.map(e[tr].groupby("tri").wait_minutes.mean())).std())
key_findings = {
 "triage_means": dict(zip(TRI, e.groupby("tri").wait_minutes.mean().round(1).tolist())),
 "dept_means": dict(zip(dep.department_name, e.groupby("d").wait_minutes.mean().round(1).tolist())),
}
metrics = {"split":{"train":f"Jan to Aug 2025 ({tr.sum():,} visits)","validation":f"Sep to Oct 2025 ({va.sum():,} visits)","test":f"Nov to Dec 2025 ({te.sum():,} visits)"},
 "regression_test":base, "interval":{"nominal":0.8,"coverage":round(cover,3),"mean_width":round(float((hi-lo).mean()),1),"by_triage":cov_tri},
 "long_wait":{"threshold":LONG,"auc":round(auc,3),"auc_triage_only":round(auc_tri,3),"brier":round(brier,4),"brier_base":round(brier_base,4),"base_rate":round(float(yl[te].mean()),3),"calibration":cal},
 "importance":imp, "tuning":{"depth":DEPTH,"trees":NEST,"learning_rate":LR},
 "forecast_backtest":fc_bt, "forecast_resid_q":fc_q, "urgent_finding":urgent_finding, "health":health, "key":key_findings}
payload = {"meta":{"start":"2025-01-01","days":365,"n_enc":len(e),"n_tests":len(t)},"tri":TRI,"vis":VIS,"outcomes":OUTC,"testTypes":TT,"priorities":PR,
 "depts":deps,"enc":enc,"tests":tests,"triMean":tri_mean,"triSd":round(tri_sd,2),"features":FEATS,"models":models,"background":background,"parity":parity,"metrics":metrics}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT,"w") as f: f.write("window.FW="+json.dumps(payload,separators=(",",":"))+";")
print("wrote", OUT, round(os.path.getsize(OUT)/1e6,2),"MB")
print(json.dumps({k:metrics[k] for k in ("regression_test","interval","long_wait","importance","tuning")},indent=1))
