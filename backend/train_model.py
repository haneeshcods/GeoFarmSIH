import joblib
import pandas as pd

from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score


data = {
    "temperature": [25, 27, 29, 31, 33, 26, 28, 30, 32, 24],
    "humidity": [50, 55, 65, 75, 85, 45, 70, 80, 90, 40],
    "rainfall": [0, 2, 5, 10, 20, 0, 8, 15, 25, 1],
    "wind_speed": [10, 9, 7, 6, 4, 12, 8, 5, 3, 11],
    "disease": [0, 0, 0, 1, 1, 0, 1, 1, 1, 0]
}

df = pd.DataFrame(data)

X = df[
    [
        "temperature",
        "humidity",
        "rainfall",
        "wind_speed"
    ]
]

y = df["disease"]

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.2,
    random_state=42
)

model = XGBClassifier(
    n_estimators=100,
    max_depth=3,
    learning_rate=0.1,
    random_state=42
)

model.fit(X_train, y_train)

predictions = model.predict(X_test)

accuracy = accuracy_score(y_test, predictions)

print("Model accuracy:", accuracy)

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "model")

os.makedirs(MODEL_DIR, exist_ok=True)

MODEL_PATH = os.path.join(MODEL_DIR, "disease_model.pkl")

joblib.dump(model, MODEL_PATH)

print("Model saved successfully!")
print("Saved to:", MODEL_PATH)




