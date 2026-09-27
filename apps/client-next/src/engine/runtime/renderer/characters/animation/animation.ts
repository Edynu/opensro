import {createCharacterPose as createPose} from "@/engine/foundation/animation/animation-pose";
import type {CharacterModel} from "@/engine/contracts/character";
export function createCharacterPose(model:CharacterModel){return createPose(model);}
