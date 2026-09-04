import requests
from datetime import datetime


# Nashik coordinates
LATITUDE = 20.0059
LONGITUDE = 73.7910


def get_weather(latitude=LATITUDE, longitude=LONGITUDE):
    """
    Fetch real weather data for a farm location.
    """

    url = "https://api.open-meteo.com/v1/forecast"

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": "temperature_2m,relative_humidity_2m,rain",
        "daily": "temperature_2m_max,temperature_2m_min,rain_sum",
        "timezone": "Asia/Kolkata",
        "forecast_days": 14,
    }

    response = requests.get(url, params=params, timeout=10)

    response.raise_for_status()

    data = response.json()

    return data


def get_daily_weather(latitude=LATITUDE, longitude=LONGITUDE):
    """
    Return simplified daily weather data
    that can directly be used by our forecasting engine.
    """

    data = get_weather(latitude, longitude)

    daily = data["daily"]

    weather = []

    for i in range(len(daily["time"])):
        weather.append({
            "date": daily["time"][i],
            "tempMax": daily["temperature_2m_max"][i],
            "tempMin": daily["temperature_2m_min"][i],
            "rainfall": daily["rain_sum"][i],
        })

    return weather


if __name__ == "__main__":

    print("\n🌦️ Geo-Farm Weather Engine")
    print("-" * 40)

    weather = get_weather()

    print("Current temperature:",
          weather["current"]["temperature_2m"], "°C")

    print("Current humidity:",
          weather["current"]["relative_humidity_2m"], "%")

    print("Current rainfall:",
          weather["current"]["rain"], "mm")

    print("\n📅 Next 14 days:")
    print("-" * 40)

    for day in get_daily_weather():
        print(
            day["date"],
            "| Max:", day["tempMax"],
            "| Min:", day["tempMin"],
            "| Rain:", day["rainfall"]
        )