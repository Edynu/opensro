package quest

// The route, item categories, herb count and kill count are v1.150
// SN_TALK/SN_CON_QTUTORIAL_CH. Exact glove grade and equip-check timing are
// explicit reconstruction choices; see the quest work item, not native proof.
func chineseTutorialStages() []QuestStage {
	talk := func(npc, contents, prompt string) QuestStage {
		return QuestStage{ContentsSymbol: "SN_CON_QTUTORIAL_CH_" + contents,
			QuestSpec: QuestSpec{Objective: ObjectiveTalk, EndNpcCodename: npc, CompletePromptSymbol: "SN_TALK_QTUTORIAL_CH_" + prompt}}
	}
	intro := talk("NPC_CH_GENARAL", "01", "06")
	armor := talk("NPC_CH_ARMOR", "02", "10")
	armor.RewardItems = []RewardItemLead{{ItemCodename: "ITEM_CH_M_LIGHT_01_AA_A", Count: 1}}
	items := talk("NPC_CH_GENARAL", "01", "16")
	ring := talk("NPC_CH_ACCESSORY", "03", "18")
	ring.RewardItems = []RewardItemLead{{ItemCodename: "ITEM_CH_RING_01_A", Count: 1}}
	wear := talk("NPC_CH_ACCESSORY", "03", "21")
	wear.EquippedItem = "ITEM_CH_RING_01_A"
	errand := talk("NPC_CH_GENARAL", "01", "26")
	errand.RewardGold = 200
	pharmacy := talk("NPC_CH_POTION", "04", "45")
	herb := talk("NPC_CH_GENARAL", "04", "29")
	herb.Objective, herb.CollectItemCodename, herb.CollectCount = ObjectiveCollect, "ITEM_ETC_HP_POTION_01", 1
	hunt := talk("NPC_CH_GENARAL", "05", "35")
	hunt.Objective, hunt.KillCount = ObjectiveKill, 30
	hunt.KillMonsterCodenames = []string{"MOB_CH_MANGNYANG"}
	return []QuestStage{intro, armor, items, ring, wear, errand, pharmacy, herb, hunt}
}
