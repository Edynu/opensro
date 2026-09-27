package action

import (
	"strconv"
	"strings"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/commerce"
	"opensro.online/server/internal/game/item/inventory"
)

// A display quote is produced by the same pricing owner as the transaction.
// The browser refreshes it when opening a sale; native 706D still revalidates
// the current item and tax under the authority door. It never trusts this price.
type shopSaleQuote struct {
	NoBuyback bool   `json:"noBuyback"`
	Slot      uint8  `json:"slot"`
	Ref       uint32 `json:"refObjId"`
	Quantity  uint16 `json:"quantity"`
	Price     string `json:"price"`
}

func (rt *Runtime) shopSaleQuotes(division string, c *enterworld.Character, merchant uint32) []shopSaleQuote {
	quotes := []shopSaleQuote{}
	for _, item := range invItemsFromRows(c.MissionInventory) {
		if item.Slot < inventory.EquipmentSlotEnd {
			continue
		}
		ref, found := rt.deps.ItemReferences().ItemRefByCodename(item.Codename)
		if !found || ref == nil || ref.RefObjID != item.RefObjID || ref.TypeFlags() != item.TypeFlags || !commerceSaleAdmitted(ref) {
			continue
		}
		price, _, valid := commerce.SalePrices(ref, item.MagicOptions, rt.Commerce.Magic, rt.commerceTax(division, merchant, c))
		if valid {
			quotes = append(quotes, shopSaleQuote{commerceNoBuyback(item.TypeFlags, item.Codename), item.Slot, item.RefObjID, item.Quantity, strconv.FormatUint(price, 10)})
		}
	}
	return quotes
}

// Retail 5B6D22 tests RefObjData+A5, populated from itemdata column 17.
// Quote and commit share this O(1) policy: a monster drop need not occur in
// any shop catalogue. Missing/malformed authority never grants permission.
func commerceSaleAdmitted(ref *enterworld.ItemRef) bool {
	if ref == nil {
		return false
	}
	value, present := ref.NativeFields.Lookup("canSell")
	return present && value >= 1 && value <= 255 && value == float64(uint8(value))
}

// v1.150 80B500 fills the reference registry checked by 563F40 on sales.
func commerceNoBuyback(flags uint16, codename string) bool {
	if flags&0x7fe == 0x46c || flags&0x7e == 0x4c || flags&0x7fe == 0x6ac {
		return true
	}
	name := strings.ToUpper(codename)
	for _, prefix := range []string{"ITEM_QNO", "ITEM_QTUTORIAL", "ITEM_QSP", "ITEM_QCX", "ITEM_ETC_E", "SN_ITEM_EVENT", "SN_ITEM_ETC_TAIWAN_50000_GOLD"} {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}
