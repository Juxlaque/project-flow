#pragma once

#include "FortPlayerController.h"
#include "FortPlayerStateAthena.h"
#include "FortPlayerPawn.h"
#include "SoftObjectPtr.h"
#include "FortKismetLibrary.h"
#include "AthenaMarkerComponent.h"
#include "FortVolume.h"
#include "AthenaPlayerMatchReport.h"

static void ApplyHID(AFortPlayerPawn* Pawn, UObject* HeroDefinition, bool bUseServerChoosePart = false)
{
	if (!Pawn || !HeroDefinition)
		return;

	using UFortHeroSpecialization = UObject;

	static auto SpecializationsOffset = HeroDefinition->GetOffset("Specializations");
	auto& Specializations = HeroDefinition->Get<TArray<TSoftObjectPtr<UFortHeroSpecialization>>>(SpecializationsOffset);

	auto PlayerState = Pawn->GetPlayerState();
	if (!PlayerState)
	{
		auto PC = (AController*)Pawn->GetController();
		if (PC)
			PlayerState = PC->GetPlayerState();
	}

	if (!PlayerState)
		return;

	for (int i = 0; i < Specializations.Num(); i++)
	{
		auto& SpecializationSoft = Specializations.at(i);

		static auto FortHeroSpecializationClass = FindObject<UClass>(L"/Script/FortniteGame.FortHeroSpecialization");
		auto Specialization = SpecializationSoft.Get(FortHeroSpecializationClass, true);

		if (Specialization)
		{
			static auto Specialization_CharacterPartsOffset = Specialization->GetOffset("CharacterParts");
			auto& CharacterParts = Specialization->Get<TArray<TSoftObjectPtr<UObject>>>(Specialization_CharacterPartsOffset);

			static auto CustomCharacterPartClass = FindObject<UClass>(L"/Script/FortniteGame.CustomCharacterPart");

			if (bUseServerChoosePart)
			{
				for (int z = 0; z < CharacterParts.Num(); z++)
				{
					Pawn->ServerChoosePart((EFortCustomPartType)z, CharacterParts.at(z).Get(CustomCharacterPartClass, true));
				}

				continue; // hm?
			}

			bool aa;

			TArray<UObject*> CharacterPartsaa;

			for (int z = 0; z < CharacterParts.Num(); z++)
			{
				auto& CharacterPartSoft = CharacterParts.at(z, GetSoftObjectSize());
				auto CharacterPart = CharacterPartSoft.Get(CustomCharacterPartClass, true);

				CharacterPartsaa.Add(CharacterPart);

				continue;
			}

			UFortKismetLibrary::ApplyCharacterCosmetics(GetWorld(), CharacterPartsaa, PlayerState, &aa);
			CharacterPartsaa.Free();
		}
	}
}

static bool ApplyCID(AFortPlayerPawn* Pawn, UObject* CID, bool bUseServerChoosePart = false)
{
	if (!CID || !Pawn)
		return false;

	if (Fortnite_Version == 1.72)
		return false;

	static auto HeroDefinitionOffset = CID->GetOffset("HeroDefinition", false);
	if (HeroDefinitionOffset == -1)
		return false;

	auto HeroDefinition = CID->Get(HeroDefinitionOffset);
	if (!HeroDefinition)
		return false;

	ApplyHID(Pawn, HeroDefinition, bUseServerChoosePart);

	return true;
}

struct FGhostModeRepData
{
	bool& IsInGhostMode()
	{
		static auto bInGhostModeOffset = FindOffsetStruct("/Script/FortniteGame.GhostModeRepData", "bInGhostMode");
		return *(bool*)(__int64(this) + bInGhostModeOffset);
	}

	UFortWorldItemDefinition*& GetGhostModeItemDef()
	{
		static auto GhostModeItemDefOffset = FindOffsetStruct("/Script/FortniteGame.GhostModeRepData", "GhostModeItemDef");
		return *(UFortWorldItemDefinition**)(__int64(this) + GhostModeItemDefOffset);
	}
};

class AFortPlayerControllerAthena : public AFortPlayerController
{
public:
	static inline void (*GetPlayerViewPointOriginal)(AFortPlayerControllerAthena* PlayerController, FVector& Location, FRotator& Rotation);
	static inline void (*ServerReadyToStartMatchOriginal)(AFortPlayerControllerAthena* PlayerController);
	static inline void (*ServerRequestSeatChangeOriginal)(AFortPlayerControllerAthena* PlayerController, int TargetSeatIndex);
	static inline void (*EnterAircraftOriginal)(UObject* PC, AActor* Aircraft);
	static inline void (*StartGhostModeOriginal)(UObject* Context, FFrame* Stack, void* Ret);
	static inline void (*EndGhostModeOriginal)(AFortPlayerControllerAthena* PlayerController);

	void SpectateOnDeath() // actually in zone
	{
		static auto SpectateOnDeathFn = FindObject<UFunction>(L"/Script/FortniteGame.FortPlayerControllerZone.SpectateOnDeath") ?
			FindObject<UFunction>(L"/Script/FortniteGame.FortPlayerControllerZone.SpectateOnDeath") :
			FindObject<UFunction>(L"/Script/FortniteGame.FortPlayerControllerAthena.SpectateOnDeath");

		this->ProcessEvent(SpectateOnDeathFn);
	}

	class UAthenaResurrectionComponent*& GetResurrectionComponent()
	{
		static auto ResurrectionComponentOffset = GetOffset("ResurrectionComponent");
		return Get<class UAthenaResurrectionComponent*>(ResurrectionComponentOffset);
	}

	AFortPlayerStateAthena* GetPlayerStateAthena()
	{
		return (AFortPlayerStateAthena*)GetPlayerState();
	}

	FGhostModeRepData* GetGhostModeRepData()
	{
		static auto GhostModeRepDataOffset = GetOffset("GhostModeRepData", false);

		if (GhostModeRepDataOffset == -1)
			return nullptr;

		return GetPtr<FGhostModeRepData>(GhostModeRepDataOffset);
	}

	bool IsInGhostMode()
	{
		auto GhostModeRepData = GetGhostModeRepData();

		if (!GhostModeRepData)
			return false;

		return GhostModeRepData->IsInGhostMode();
	}

	UAthenaMarkerComponent* GetMarkerComponent()
	{
		static auto MarkerComponentOffset = GetOffset("MarkerComponent");
		return Get<UAthenaMarkerComponent*>(MarkerComponentOffset);
	}

	AFortVolume*& GetCreativePlotLinkedVolume()
	{
		static auto CreativePlotLinkedVolumeOffset = GetOffset("CreativePlotLinkedVolume");
		return Get<AFortVolume*>(CreativePlotLinkedVolumeOffset);
	}

	void ClientClearDeathNotification() // actually in zone
	{
		auto ClientClearDeathNotificationFn = FindFunction("ClientClearDeathNotification");

		if (ClientClearDeathNotificationFn)
			this->ProcessEvent(ClientClearDeathNotificationFn);
	}

	UAthenaPlayerMatchReport** GetMatchReport()
	{
		static auto MatchReportOffset = GetOffset("MatchReport", false);
		return MatchReportOffset == -1 ? nullptr : GetPtr<UAthenaPlayerMatchReport*>(MatchReportOffset);
	}

	void ClientSendTeamStatsForPlayer(FAthenaMatchTeamStats* TeamStats)
	{
		static auto ClientSendTeamStatsForPlayerFn = FindObject<UFunction>("/Script/FortniteGame.FortPlayerControllerAthena.ClientSendTeamStatsForPlayer");
		static auto ParamSize = ClientSendTeamStatsForPlayerFn->GetPropertiesSize();
		auto Params = malloc(ParamSize);

		memcpy_s(Params, ParamSize, TeamStats, TeamStats->GetStructSize());

		this->ProcessEvent(ClientSendTeamStatsForPlayerFn, Params);

		free(Params);
	}

	void RespawnPlayerAfterDeath(bool bEnterSkydiving)
	{
		static auto RespawnPlayerAfterDeathFn = FindObject<UFunction>(L"/Script/FortniteGame.FortPlayerControllerAthena.RespawnPlayerAfterDeath");

		if (RespawnPlayerAfterDeathFn)
		{
			this->ProcessEvent(RespawnPlayerAfterDeathFn, &bEnterSkydiving);
		}
		else
		{
			// techinally we can remake this as all it really does on older versions is clear deathinfo (I think?)
		}
	}

	void ClientOnPawnRevived(AController* EventInstigator) // actually zone // idk what this actually does but i call it
	{
		static auto ClientOnPawnRevivedFn = FindObject<UFunction>(L"/Script/FortniteGame.FortPlayerControllerZone.ClientOnPawnRevived");
		this->ProcessEvent(ClientOnPawnRevivedFn, &EventInstigator);
	}

	bool IsMarkedAlive()
	{
		static auto bMarkedAliveOffset = GetOffset("bMarkedAlive", false);

		if (bMarkedAliveOffset == -1) // nots ure if this is possible
			return true;

		static auto bMarkedAliveFieldMask = GetFieldMask(GetProperty("bMarkedAlive"));
		return ReadBitfieldValue(bMarkedAliveOffset, bMarkedAliveFieldMask);
	}

	static void StartGhostModeHook(UObject* Context, FFrame* Stack, void* Ret); // we could native hook this but eh
	static void EndGhostModeHook(AFortPlayerControllerAthena* PlayerController);
	static void ServerCreativeSetFlightSpeedIndexHook(UObject* Context, FFrame* Stack);
	static void EnterAircraftHook(UObject* PC, AActor* Aircraft);
	static void ServerRequestSeatChangeHook(AFortPlayerControllerAthena* PlayerController, int TargetSeatIndex); // actually in zone
	static void ServerRestartPlayerHook(AFortPlayerControllerAthena* Controller);
	static void ServerGiveCreativeItemHook(AFortPlayerControllerAthena* Controller, FFortItemEntry CreativeItem);
	static void ServerTeleportToPlaygroundLobbyIslandHook(AFortPlayerControllerAthena* Controller);
	static void ServerAcknowledgePossessionHook(APlayerController* Controller, APawn* Pawn);
	static void ServerPlaySquadQuickChatMessageHook(AFortPlayerControllerAthena* PlayerController, __int64 ChatEntry, __int64 SenderID);
	static void GetPlayerViewPointHook(AFortPlayerControllerAthena* PlayerController, FVector& Location, FRotator& Rotation);
	static void ServerReadyToStartMatchHook(AFortPlayerControllerAthena* PlayerController);
	static void UpdateTrackedAttributesHook(AFortPlayerControllerAthena* PlayerController);
	static void ServerClientIsReadyToRespawnHook(AFortPlayerControllerAthena* PlayerControllerAthena); // 1:1

	static UClass* StaticClass()
	{
		static auto Class = FindObject<UClass>(L"/Script/FortniteGame.FortPlayerControllerAthena");
		return Class;
	}
};