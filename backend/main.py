from fastapi import FastAPI
import joblib
import pandas as pd
import os

app = FastAPI(title="GeoFarm API")


# ============================================================
# LOAD TRAINED XGBOOST MODEL
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

MODEL_PATH = os.path.join(
    BASE_DIR,
    "model",
    "disease_model.pkl"
)

model = joblib.load(MODEL_PATH)


# ============================================================
# HOME
# ============================================================

@app.get("/")
def home():
    return {
        "project": "GeoFarm",
        "status": "Backend is running",
        "model": "XGBoost loaded successfully"
    }


# ============================================================
# DISEASE RISK PREDICTION
# ============================================================

@app.get("/predict")
def predict(
    temperature: float,
    humidity: float,
    rainfall: float,
    wind_speed: float
):

    # --------------------------------------------------------
    # Create input DataFrame
    # --------------------------------------------------------

    input_data = pd.DataFrame([
        {
            "temperature": temperature,
            "humidity": humidity,
            "rainfall": rainfall,
            "wind_speed": wind_speed
        }
    ])


    # --------------------------------------------------------
    # Get disease probability
    # --------------------------------------------------------

    probability = model.predict_proba(input_data)[0][1]

    # IMPORTANT:
    # Convert NumPy float32 → normal Python float
    probability = float(probability)


    # --------------------------------------------------------
    # Calculate risk score
    # --------------------------------------------------------

    risk_score = round(probability * 100, 2)

    # Make absolutely sure FastAPI gets a normal float
    risk_score = float(risk_score)


    # --------------------------------------------------------
    # Determine risk level
    # --------------------------------------------------------

    if risk_score >= 80:
        risk_level = "CRITICAL"

    elif risk_score >= 60:
        risk_level = "HIGH"

    elif risk_score >= 40:
        risk_level = "MEDIUM"

    else:
        risk_level = "LOW"


    # --------------------------------------------------------
    # Return result
    # --------------------------------------------------------

    return {
        "temperature": float(temperature),
        "humidity": float(humidity),
        "rainfall": float(rainfall),
        "wind_speed": float(wind_speed),
        "risk_score": risk_score,
        "risk_level": risk_level
    }