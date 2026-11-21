export const GEOLOGY_VOCABULARY = Object.freeze({
  Lithology: [
    "Granite","Granodiorite","Diorite","Gabbro","Basalt","Andesite","Rhyolite","Dacite",
    "Peridotite","Dunite","Pyroxenite","Serpentinite","Limestone","Dolostone","Sandstone",
    "Siltstone","Shale","Mudstone","Conglomerate","Breccia","Chert","Evaporite","Slate",
    "Phyllite","Schist","Gneiss","Quartzite","Marble","Amphibolite","Hornfels","Mylonite"
  ],
  Mineral: [
    "Quartz","Calcite","Dolomite","Plagioclase","K-feldspar","Muscovite","Biotite","Chlorite",
    "Epidote","Actinolite","Tremolite","Talc","Serpentine","Magnetite","Hematite","Goethite",
    "Pyrite","Chalcopyrite","Bornite","Chalcocite","Covellite","Sphalerite","Galena",
    "Molybdenite","Arsenopyrite","Pyrrhotite","Chromite","Ilmenite","Rutile","Garnet",
    "Tourmaline","Apatite","Fluorite","Barite","Gypsum"
  ],
  Altration: [
    "Silicification","Sericitization","Chloritization","Epidotization","Propylitic",
    "Phyllic","Argillic","Advanced argillic","Potassic","Sodic","Carbonatization",
    "Albitization","Hematitization","Limonitization","Serpentinization","Talc-carbonate",
    "Skarn","Greisen"
  ],
  Structur: [
    "Bedding","Foliation","Cleavage","Schistosity","Gneissic banding","Lineation",
    "Joint","Fracture","Vein","Shear zone","Fault","Fold","Brecciation","Stockwork",
    "Dyke","Sill","Lithological contact"
  ],
  Type_Fault: [
    "Normal","Reverse","Thrust","Strike-slip","Dextral","Sinistral","Oblique-slip","Reactivated"
  ],
  Contact: ["Sharp","Gradational","Faulted","Intrusive","Conformable","Unconformable","Sheared"],
  colour: ["White","Grey","Black","Green","Dark green","Light green","Brown","Red","Pink","Yellow","Orange","Purple"]
});

export function vocabularyForField(fieldName) {
  return GEOLOGY_VOCABULARY[fieldName] || [];
}
