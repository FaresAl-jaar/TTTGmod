if SERVER then
    local bit = bit
    local DEFAULT_ENDPOINT = "http://127.0.0.1:3000/ttt"
    local endpointCVar = CreateConVar("ttt_discord_endpoint", DEFAULT_ENDPOINT, FCVAR_ARCHIVE, "Webhook endpoint for Discord relay")
    local serverIdCVar = CreateConVar("ttt_discord_server_id", "gmod-1", FCVAR_ARCHIVE, "Server identifier for Discord relay")
    local sharedSecretCVar = CreateConVar("ttt_discord_secret", "", FCVAR_ARCHIVE, "Optional shared secret for webhook signing")
    local roundSequence = 0
    local currentRoundId = ""
    local pendingRoundId = nil
    local playerAliveState = {}

    local blockSize = 64 -- bytes for SHA-256

    local function hexToBinary(hex)
        if not hex or hex == "" then return "" end
        return hex:gsub("..", function(cc)
            return string.char(tonumber(cc, 16) or 0)
        end)
    end

    local function xorString(str, value)
        local bytes = {}
        for i = 1, #str do
            local b = string.byte(str, i)
            bytes[i] = string.char(bit.bxor(b, value))
        end
        return table.concat(bytes)
    end

    local function hmacSha256(key, data)
        if key == "" then return "" end

        if #key > blockSize then
            key = hexToBinary(util.SHA256(key))
        end

        if #key < blockSize then
            key = key .. string.rep(string.char(0), blockSize - #key)
        end

        local oKeyPad = xorString(key, 0x5c)
        local iKeyPad = xorString(key, 0x36)

        local inner = util.SHA256(iKeyPad .. data)
        if not inner then return "" end
        local digest = util.SHA256(oKeyPad .. hexToBinary(inner))
        return digest or ""
    end

    local function getEndpoint()
        local endpoint = endpointCVar:GetString()
        if endpoint == nil or endpoint == "" then
            return DEFAULT_ENDPOINT
        end
        return endpoint
    end

    local function getServerId()
        local sid = serverIdCVar:GetString()
        if sid == nil or sid == "" then
            return "gmod-1"
        end
        return sid
    end

    local function getSharedSecret()
        local secret = sharedSecretCVar:GetString()
        if secret == nil then
            return ""
        end
        return secret
    end

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
        local endpoint = getEndpoint()
        if endpoint == nil or endpoint == "" then
            log("Webhook endpoint is not configured; skipping event")
            return
        end

        local json = util.TableToJSON(payload)
        if not json then
            log("Failed to encode payload for event " .. tostring(payload.event))
            return
        end

        local headers = {
            ["Content-Type"] = "application/json",
            ["Content-Length"] = tostring(#json)
        }

        local secret = getSharedSecret()
        if secret ~= "" then
            local signature = hmacSha256(secret, json)
            if signature ~= "" then
                headers["X-TTT-SIGN"] = signature
            end
        end

        HTTP({
            url = endpoint,
            method = "POST",
            headers = headers,
            body = json,
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
            server_id = getServerId(),
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
