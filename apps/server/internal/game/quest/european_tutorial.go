package quest

// v1.150 questdata/questcontents chain and SN_TALK/SN_PAYCON contracts.
// Quest 7 has no localized dialogue/content in this release; it is deliberately
// not made into a blank NPC quest. The visible tutorial ends at quest 6.
var europeanTutorialSpecs = []QuestSpec{
	{Codename: "QNO_EU_TUTORIAL_2", KindByte: 1, Objective: ObjectiveTalk,
		RequiredQuests:   []string{"QNO_EU_TUTORIAL_1"},
		StartNpcCodename: "NPC_EU_ARMOR", EndNpcCodename: "NPC_EU_ARMOR",
		OfferPromptSymbol: "SN_TALK_QNO_EU_TUTORIAL_2_01", CompletePromptSymbol: "SN_TALK_QNO_EU_TUTORIAL_2_06", InventoryFullSymbol: "SN_TALK_QNO_EU_TUTORIAL_2_07",
		RewardItems: []RewardItemLead{{ItemCodename: "ITEM_EU_M_HEAVY_01_AA_A", Count: 1}}},
	{Codename: "QNO_EU_TUTORIAL_3", KindByte: 1, Objective: ObjectiveTalk,
		RequiredQuests:   []string{"QNO_EU_TUTORIAL_2"},
		StartNpcCodename: "NPC_EU_ACCESSORY", EndNpcCodename: "NPC_EU_ACCESSORY",
		OfferPromptSymbol: "SN_TALK_QNO_EU_TUTORIAL_3_01", CompletePromptSymbol: "SN_TALK_QNO_EU_TUTORIAL_3_07", InventoryFullSymbol: "SN_TALK_QNO_EU_TUTORIAL_3_08",
		RewardGold: 200, RewardItems: []RewardItemLead{{ItemCodename: "ITEM_EU_RING_01_A", Count: 1}}},
	{Codename: "QNO_EU_TUTORIAL_4", KindByte: 1, Objective: ObjectiveTalk,
		RequiredQuests:   []string{"QNO_EU_TUTORIAL_3"},
		StartNpcCodename: "NPC_EU_POTION", EndNpcCodename: "NPC_EU_POTION",
		OfferPromptSymbol: "SN_TALK_QNO_EU_TUTORIAL_4_01", CompletePromptSymbol: "SN_TALK_QNO_EU_TUTORIAL_4_05", RewardExp: 60},
	{Codename: "QNO_EU_TUTORIAL_5", KindByte: 1, Objective: ObjectiveCollect,
		RequiredQuests:   []string{"QNO_EU_TUTORIAL_4"},
		StartNpcCodename: "NPC_EU_SMITH", EndNpcCodename: "NPC_EU_SMITH",
		CollectItemCodename: "ITEM_ETC_HP_POTION_01", CollectCount: 1,
		OfferPromptSymbol: "SN_TALK_QNO_EU_TUTORIAL_5_01", CompletePromptSymbol: "SN_TALK_QNO_EU_TUTORIAL_5_07", InventoryFullSymbol: "SN_TALK_QNO_EU_TUTORIAL_5_08",
		RewardItems: []RewardItemLead{{ItemCodename: "ITEM_QTUTORIAL_EU_01", Count: 1}}},
	{Codename: "QNO_EU_TUTORIAL_6", KindByte: 1, Objective: ObjectiveKill,
		RequiredQuests:   []string{"QNO_EU_TUTORIAL_5"},
		StartNpcCodename: "NPC_EU_SMITH", EndNpcCodename: "NPC_EU_ADVICE",
		KillCount: 20, KillMonsterCodenames: []string{"MOB_EU_MOVOI", "MOB_EU_MOVOI_CLON"},
		OfferPromptSymbol: "SN_TALK_QNO_EU_TUTORIAL_5_07", CompletePromptSymbol: "SN_TALK_QNO_EU_TUTORIAL_6_03", InventoryFullSymbol: "SN_TALK_QNO_EU_TUTORIAL_6_04",
		RewardExp: 350, RewardItems: []RewardItemLead{{ItemCodename: "ITEM_QTUTORIAL_EU_2_01", Count: 1}}},
}
