# GeoFarm SIH - Project Context

## Project Goal

GeoFarm is an early crop pest and disease detection platform
for small and marginal farmers in Maharashtra, India.

The goal is to detect risk early using:

1. Weather conditions
2. Pest-trap monitoring
3. Crop/leaf images
4. ML-based risk prediction

The system should eventually provide:
- Location-based risk
- Crop-specific pest/disease prediction
- Risk score
- Reason for the risk
- Recommended field action
- Historical trends
- Alerts

## Current Architecture

React Frontend
        ↓
FastAPI Backend
        ↓
Machine Learning
        ↓
PostgreSQL / TimescaleDB

Additional AI modules:
- CNN for visual symptoms
- XGBoost for environmental risk
- LSTM planned for time-series forecasting
- Degree-day calculations
- IoT pest-trap data

## Current Folder Structure

GeoFarmSIH-main/
│
├── ai_engine/
│   ├── degree_days.py
│   └── weather.py
│
├── backend/
│   ├── main.py
│   ├── train_model.py
│   ├── requirements.txt
│   └── model/
│       └── disease_model.pkl
│
├── src/
│   └── components/
│
└── node_modules/

## Current ML Status

XGBoost has been successfully trained.

IMPORTANT:
The current training dataset is only placeholder data.
It contains:
- temperature
- humidity
- rainfall
- wind_speed

The final system MUST replace this with a realistic agricultural dataset.

## Current Backend

FastAPI exists in backend/main.py.

The trained XGBoost model is stored at:

backend/model/disease_model.pkl

## Existing AI Engine

ai_engine/weather.py
ai_engine/degree_days.py

These should be reused rather than unnecessarily recreated.

## Required Final System

The final architecture should become:

Weather API
     ↓
FastAPI
     ↓
Database
     ↓
Feature Engineering
     ↓
XGBoost / LSTM
     ↓
Risk Engine
     ↓
React Dashboard / GIS Map

IoT sensors should eventually send:

- device_id
- latitude
- longitude
- timestamp
- temperature
- humidity
- pest_count
- other sensor readings

The system should combine:

Weather Risk
+
IoT Pest Evidence
+
Visual/CNN Evidence
=
GeoFarm Risk Score

The output should NOT simply say "HIGH".

It should provide:

- Risk score
- Risk level
- Suspected pest/disease
- Location
- Crop
- Evidence/reason
- Recommended action

## Important Constraints

- Designed for Maharashtra
- Designed for small/marginal farmers
- Affordable
- Practical
- Smartphone-friendly
- Should work as a decision-support system
- Do not claim fake accuracy
- Do not use fabricated real-world results
- Clearly separate prototype/demo components from production-ready components