package quest

// v1.150 SN_CON/SN_PAYCON and the BO->SP questcontents edge own these
// counts, rewards and chain order. Quest.sct 0x13396/0x143d4 supplies
// the NPC/target mechanism. Its 25-kill counts and SP universal potion
// differ from v1.150 (50 kills / HP herbs) and are intentionally rejected.
var banditChainSpecs = []QuestSpec{
	{
		Codename: "QNO_CH_GENARAL_BO_1", KindByte: 1, Objective: ObjectiveKill,
		KillMonsterCodenames: []string{"MOB_CH_BANDITARCHER", "MOB_CH_BANDITARCHER_CLON"}, KillCount: 50,
		RewardExp: 9500, RewardItems: []RewardItemLead{{ItemCodename: "ITEM_ETC_MP_POTION_01", Count: 50}},
		StartNpcCodename: "NPC_CH_GENARAL_BO", EndNpcCodename: "NPC_CH_GENARAL_BO",
		OfferPromptSymbol: "SN_TALK_QNO_CH_GENARAL_BO_1_01", CompletePromptSymbol: "SN_TALK_QNO_CH_GENARAL_BO_1_06",
		InventoryFullSymbol: "SN_TALK_QNO_CH_GENARAL_BO_1_05",
	},
	{
		Codename: "QNO_CH_GENARAL_SP_1", RequiredQuests: []string{"QNO_CH_GENARAL_BO_1"}, KindByte: 1, Objective: ObjectiveKill,
		KillMonsterCodenames: []string{"MOB_CH_BANDIT", "MOB_CH_BANDIT_CLON"}, KillCount: 50,
		RewardExp: 14500, RewardItems: []RewardItemLead{{ItemCodename: "ITEM_ETC_HP_POTION_01", Count: 50}},
		StartNpcCodename: "NPC_CH_GENARAL_SP", EndNpcCodename: "NPC_CH_GENARAL_SP",
		OfferPromptSymbol: "SN_TALK_QNO_CH_GENARAL_SP_1_01", CompletePromptSymbol: "SN_TALK_QNO_CH_GENARAL_SP_1_06",
		InventoryFullSymbol: "SN_TALK_QNO_CH_GENARAL_SP_1_05",
	},
}
