#pragma once

#ifndef CURL_STATICLIB
#define CURL_STATICLIB
#endif

#include <iostream>
#include <string>
#include <thread>
#include <mutex>
#include <curl/curl.h>

namespace QuestTracking
{
    inline std::once_flag g_curlInitFlag;

    inline void EnsureCurlInit()
    {
        std::call_once(g_curlInitFlag, []() {
            curl_global_init(CURL_GLOBAL_ALL);
        });
    }

    inline void SendActionAsync(const std::string& action, const std::string& weapon = "", const std::string& location = "")
    {
        EnsureCurlInit();

        std::thread([action, weapon, location]() {
            CURL* curl = curl_easy_init();
            if (!curl) return;

            std::string url = "http://127.0.0.1:3551/api/projectflow/quest/action";
            std::string jsonBody = "{\"action\":\"" + action + "\"";
            if (!weapon.empty()) {
                jsonBody += ",\"weapon\":\"" + weapon + "\"";
            }
            if (!location.empty()) {
                jsonBody += ",\"location\":\"" + location + "\"";
            }
            jsonBody += "}";

            struct curl_slist* headers = NULL;
            headers = curl_slist_append(headers, "Content-Type: application/json");

            curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonBody.c_str());
            curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, 2000L);
            curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, 1000L);

            curl_easy_perform(curl);

            curl_slist_free_all(headers);
            curl_easy_cleanup(curl);
        }).detach();
    }

    inline void OnChestOpened(const std::string& location = "")
    {
        SendActionAsync("chest", "", location);
    }

    inline void OnAmmoBoxOpened(const std::string& location = "")
    {
        SendActionAsync("ammobox", "", location);
    }

    inline void OnPlayerKilled(const std::string& weaponType)
    {
        SendActionAsync("kill", weaponType);
    }

    inline void OnMatchStarted()
    {
        SendActionAsync("match_start");
    }
}
