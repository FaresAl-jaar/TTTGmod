if SERVER then
    local HTTP_ENDPOINT = "http://127.0.0.1:3000/ttt"
    local SERVER_ID = "gmod-1"
    local roundSequence = 0
    local currentRoundId = ""
    local pendingRoundId = nil
    local playerAliveState = {}

    local function makeRoundId()
        roundSequence = roundSequence + 1
        local timePart = os.date("%Y%m%d-%H%M")
        return string.format("%s-%d", timePart, roundSequence)
    end

    local function getSteamID64(ply)
        if not IsValid(ply) then
            return ""
        end

        local sid64 = ply:SteamID64()
        if sid64 == "" or sid64 == nil then
            return ""
        end

        return sid64
    end

    local function log(msg)
        MsgN("[TTT Event Emitter] " .. msg)
    end

    local function postEvent(payload)
        HTTP({
            url = HTTP_ENDPOINT,
            method = "POST",
            parameters = payload,
            success = function(_, _, _, code)
                if code ~= 200 then
                    log("HTTP POST responded with code " .. tostring(code))
                end
            end,
            failed = function(err)
                log("HTTP POST failed: " .. tostring(err))
            end
        })
    end

    local function sendEvent(eventName, ply)
        local steamid64 = ""
        if ply ~= nil then
            steamid64 = getSteamID64(ply)
        end

        local payload = {
            event = eventName,
            steamid64 = steamid64,
            server_id = SERVER_ID,
            round_id = currentRoundId ~= "" and currentRoundId or (pendingRoundId or "")
        }

        postEvent(payload)
        log(string.format("Sent event '%s' for steamid64 '%s' with round '%s'", eventName, steamid64, payload.round_id))
    end

    local function resetPlayerState()
        playerAliveState = {}
    end

    hook.Add("TTTPrepareRound", "TTTDiscordRelay_Prepare", function()
        pendingRoundId = makeRoundId()
        currentRoundId = pendingRoundId
        resetPlayerState()
        sendEvent("round_prepare")
    end)

    hook.Add("TTTBeginRound", "TTTDiscordRelay_Begin", function()
        if not pendingRoundId then
            pendingRoundId = makeRoundId()
        end
        currentRoundId = pendingRoundId
        pendingRoundId = nil
        resetPlayerState()
        sendEvent("round_start")
    end)

    hook.Add("TTTEndRound", "TTTDiscordRelay_End", function()
        sendEvent("round_end")
        pendingRoundId = nil
        currentRoundId = currentRoundId or ""
        resetPlayerState()
    end)

    hook.Add("PlayerDeath", "TTTDiscordRelay_PlayerDeath", function(victim, _, _)
        if not IsValid(victim) or not victim:IsPlayer() then return end

        local sid64 = getSteamID64(victim)
        if sid64 == "" then return end

        if playerAliveState[sid64] == false then
            return
        end

        playerAliveState[sid64] = false
        sendEvent("death", victim)
    end)

    local function isRoundActive()
        if GetRoundState == nil then
            return false
        end
        local state = GetRoundState()
        return state == ROUND_ACTIVE
    end

    hook.Add("PlayerSpawn", "TTTDiscordRelay_PlayerSpawn", function(ply)
        if not IsValid(ply) or not ply:IsPlayer() then return end
        if not isRoundActive() then return end
        if ply:IsSpec() then return end

        local sid64 = getSteamID64(ply)
        if sid64 == "" then return end

        if playerAliveState[sid64] ~= false then
            playerAliveState[sid64] = true
            return
        end

        playerAliveState[sid64] = true
        sendEvent("spawn", ply)
    end)


    hook.Add("PlayerSpawnAsSpectator", "TTTDiscordRelay_Spectate", function(ply)
        if not IsValid(ply) or not ply:IsPlayer() then return end

        local sid64 = getSteamID64(ply)
        if sid64 == "" then return end

        if playerAliveState[sid64] == false then
            return
        end

        playerAliveState[sid64] = false
        sendEvent("spectate", ply)
    end)
    hook.Add("PlayerDisconnected", "TTTDiscordRelay_PlayerDisconnected", function(ply)
        local sid64 = getSteamID64(ply)
        if sid64 ~= "" then
            playerAliveState[sid64] = nil
        end
    end)
end
