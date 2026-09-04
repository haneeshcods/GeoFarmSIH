from weather import get_daily_weather


# Pest development models
PEST_MODELS = {
    "ARMYWORM": {
        "label": "Fall Armyworm",
        "base_temp": 11.5,
        "upper_temp": 35,
        "emergence_threshold": 380,
    },
    "FRUIT_FLY": {
        "label": "Fruit Fly",
        "base_temp": 13,
        "upper_temp": 33,
        "emergence_threshold": 300,
    },
}


def calculate_daily_gdd(temp_max, temp_min, base_temp, upper_temp):
    """
    Calculate Growing Degree Days for one day.
    """

    capped_max = min(temp_max, upper_temp)
    capped_min = min(temp_min, upper_temp)

    mean_temp = (capped_max + capped_min) / 2

    return max(0, mean_temp - base_temp)


def calculate_forecast(pest_key="ARMYWORM"):

    model = PEST_MODELS[pest_key]

    weather = get_daily_weather()

    cumulative_gdd = 0
    results = []

    for day in weather:

        daily_gdd = calculate_daily_gdd(
            day["tempMax"],
            day["tempMin"],
            model["base_temp"],
            model["upper_temp"],
        )

        cumulative_gdd += daily_gdd

        results.append({
            "date": day["date"],
            "tempMax": day["tempMax"],
            "tempMin": day["tempMin"],
            "rainfall": day["rainfall"],
            "dailyGDD": round(daily_gdd, 2),
            "cumulativeGDD": round(cumulative_gdd, 2),
        })

    threshold = model["emergence_threshold"]

    percent = min(
        100,
        (cumulative_gdd / threshold) * 100
    )

    # Average GDD from recent days
    recent = results[-7:]

    average_daily_gdd = (
        sum(day["dailyGDD"] for day in recent)
        / len(recent)
        if recent else 0
    )

    remaining_gdd = max(
        0,
        threshold - cumulative_gdd
    )

    if average_daily_gdd > 0:
        days_to_emergence = int(
            remaining_gdd / average_daily_gdd
        ) + 1
    else:
        days_to_emergence = None

    return {
        "pest": model["label"],
        "cumulativeGDD": round(cumulative_gdd, 2),
        "emergenceThreshold": threshold,
        "percentToEmergence": round(percent, 1),
        "averageDailyGDD": round(average_daily_gdd, 2),
        "projectedDaysToEmergence": days_to_emergence,
        "dailyData": results,
    }


if __name__ == "__main__":

    print("\n🌱 Geo-Farm Pest Forecast")
    print("=" * 45)

    forecast = calculate_forecast("ARMYWORM")

    print("Pest:", forecast["pest"])
    print("Cumulative GDD:", forecast["cumulativeGDD"])
    print("Emergence Threshold:", forecast["emergenceThreshold"])
    print("Progress:", forecast["percentToEmergence"], "%")
    print("Average Daily GDD:", forecast["averageDailyGDD"])
    print(
        "Projected Days to Emergence:",
        forecast["projectedDaysToEmergence"]
    )

    print("\n📅 Daily GDD")
    print("-" * 45)

    for day in forecast["dailyData"]:
        print(
            day["date"],
            "| GDD:", day["dailyGDD"],
            "| Cumulative:", day["cumulativeGDD"]
        )