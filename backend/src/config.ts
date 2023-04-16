export const BASE_SIMRAIL_API = "https://panel.simrail.eu:8084/";
export const BASE_AWS_API = "https://api1.aws.simrail.eu:8082/api/"
export const BASE_SIMKOL_API = "https://webhost.simkol.pl/";

export const srHeaders = {
    "User-Agent": "Simrail.app EDR vDEV",
    "xx-client": "Simrail.app EDR",
    "xx-maintainer": "CrypterEmerald",
    "xx-contact": "tally.github@gmail.com",
};

export const newInternalIdToSrId: {[k: string]: string} = {
    "T1_BZ": "124",
    "BZ": "124",
    "LZ_LC": "2375",
    "LZ_LB": "2371",
    "LZ_LA": "2374",
    "SG_R52": "3991",
    "SG": "3993",
    "DG": "719",
    "GW": "1193",
    "PS": "3436",
    "KN": "1772",
    "WP": "4987",
    "OZ": "2969",
    "PI": "3200",
    "OP_PO": "2993",
    "ZA": "5262",
    "DG_WZ": "733",
    "DG_ZA": "734",
    "SP": "4010",
    "IDZ": "1349",
    "KZ": "1655",
    "SG_PO": "4010",
    "GRO_MAZ": "1251",
    "DOR": "835",
    "KOR": "1852",
    "SZE": "4338"
}

export const POSTS: { [key: string]: string[] } = {
    "GW": [newInternalIdToSrId["GW"]],
    "PS": [newInternalIdToSrId["PS"]],
    "KN": [newInternalIdToSrId["KN"]],
    "WP": [newInternalIdToSrId["WP"]],
    "OZ": [newInternalIdToSrId["OZ"]],
    "PI": [newInternalIdToSrId["PI"]],
    "KZ": [newInternalIdToSrId["KZ"]],
    "SG": [newInternalIdToSrId["SG"], newInternalIdToSrId["SG_R52"]],
    "DG": [newInternalIdToSrId["DG"]],
    "BZ": [newInternalIdToSrId["BZ"]],
    "T1_BZ": [newInternalIdToSrId["BZ"]],
    "LZ_LC": [newInternalIdToSrId["LZ_LC"]],
    "LZ_LB": [newInternalIdToSrId["LZ_LB"]],
    "LZ_LA": [newInternalIdToSrId["LZ_LA"]],
    "ZA": [newInternalIdToSrId["ZA"]],
    "OP": [newInternalIdToSrId["OP_PO"]],
    "DG_WZ": [newInternalIdToSrId["DG_WZ"]],
    "DG_ZA": [newInternalIdToSrId["DG_ZA"]],
    "DGZ": [newInternalIdToSrId["DGZ"]],
    "SP": [newInternalIdToSrId["SP"]],
    "IDZ": [newInternalIdToSrId["IDZ"]],
    "SG_PO": [newInternalIdToSrId["SG_PO"]],
    "OP_PO": [newInternalIdToSrId["OP_PO"]],
    "GRO_MAZ": [newInternalIdToSrId["GRO_MAZ"]],
    "KOR": [newInternalIdToSrId["KOR"]],
    "DOR": [newInternalIdToSrId["DOR"]],
    "SZE": [newInternalIdToSrId["SZE"]]
};
