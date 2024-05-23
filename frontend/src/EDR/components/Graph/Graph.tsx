import React from "react";
import { nowUTC } from "../../../utils/date";
import { getStationCodes, getTimetable } from "../../../api/api";
import _keyBy from "lodash/keyBy";
import { postConfig, postToInternalIds } from "../../../config/stations";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    ReferenceLine
} from 'recharts';
import { configByType } from "../../../config/trains";
import { format } from "date-fns";
import { getDateWithHourAndMinutes } from "../../functions/timeUtils";
import { PathFinding_FindPathAndHaversineSum, PathFindingLineTrace } from "../../../pathfinding/api";
import _sortBy from "lodash/sortBy";
import { LayoutType } from "recharts/types/util/types";
import { Button } from "flowbite-react";
import { useTranslation } from "react-i18next";
import { Dictionary, find } from "lodash";
import { TimeTableRow } from "../../../customTypes/TimeTableRow";
import { StationId } from "../../../enums/stationId";

export type GraphProps = {
    post: string;
    timetable: TimeTableRow[];
    serverTime: number | undefined;
    serverCode: string | undefined;
}

const dateFormatter = (date: Date) => {
    return format(date, "HH:mm");
};
const makeDate = (dateAry: string[], serverTime: number | undefined) => {
    const dateNow = nowUTC(serverTime);
    const hours = Number.parseInt(dateAry[0]);
    const minutes = Number.parseInt(dateAry[1]);
    const isDepartureNextDay = dateNow.getHours() >= 20 && Number.parseInt(dateAry[0]) < 12;  // TODO: less but still clunky
    const isDeparturePreviousDay = Number.parseInt(dateAry[0]) >= 20 && dateNow.getHours() < 12; // TODO: less but still Clunky
    const date = getDateWithHourAndMinutes(dateNow, hours, minutes, isDepartureNextDay, isDeparturePreviousDay);
    return date.getTime();
}

const getStationTimetable = (postId: string, serverCode: string) => {
    return getTimetable(postId, serverCode).then((d) => {
        return [postId, _keyBy(d, "trainNoLocal")] as [string, Dictionary<TimeTableRow>];
    });
}

const CustomTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="custom-tooltip p-2 flex flex-col bg-white">
                <span>{label}</span>
                {_sortBy(payload, 'value').map((p) => {
                    return (
                        <div className="flex justify-between w-full" key={p.dataKey}>
                            <span style={{ color: p.stroke }}>{p.dataKey}&nbsp;&nbsp;</span><span>{format(new Date(p.value), "HH:mm")}</span>
                        </div>
                    )
                })}
            </div>
        );
    }

    return null;
}

const CustomizedAxisTick = (data: any, displayMode: string, color: string) => (props: any) => {
    const { x, y } = props;

    if (!props.value || props.index % 3 !== 0 || props.index === (displayMode === "vertical" ? data.length - 1 : 0)) return <></>;
    const maybeTrainNumber = Object.entries(data[props.index]).find((v) => v[1] === props.value);

    return (
        <g transform={`translate(${x},${y})`}>
            <text
                x={displayMode === "vertical" ? -12 : -6}
                y={displayMode === "vertical" ? -6 : -12}
                dy={16 + Math.random()}
                textAnchor="end"
                fill={color}
                transform={displayMode === "vertical" ? "rotate(-45)" : ""}
                fillOpacity={1}
                fontSize={12}
            >
                {(maybeTrainNumber as any)?.[0]}
            </text>
        </g>
    );
};

type TrainPathNode = {
    prev?: PathFindingLineTrace;
    next?: PathFindingLineTrace;
}

function representIntTime(time: Date) {
    return Number.parseInt(format(time, "HHmm"));
}

// TODO: This code is WET and have been written in an envening. Neeeeds refactoring of course ! (so it can be DRY :D)
/**
 * timetable - sorted rows of timetable by scheduledArrivalObject 
 * post - current post ID
 * serverTime - current server time in number. I don't know its exact format.
 */
const LegacyGraphContent: React.FC<GraphProps> = ({ timetable, post, serverTime, serverCode }) => {
    const [displayMode, setDisplayMode] = React.useState<LayoutType>("vertical");
    const [zoom, setZoom] = React.useState<number>(1);
    const [serverTimeObject, setServerTimeObject] = React.useState(nowUTC(serverTime));
    const currentHourSort = representIntTime(serverTimeObject);
    const [neighboursTimetables, setNeighboursTimetables] = React.useState<Dictionary<Dictionary<TimeTableRow>>>();
    const [allPathsOfPosts, setAllPathsOfPosts] = React.useState<{ [postId: string]: TrainPathNode }>();
    const [data, setData] = React.useState<any[]>();
    const { t } = useTranslation();
    const timetableRowsWithinRange: { [trainNo: string]: TimeTableRow } = React.useMemo(
        () => _keyBy(timetable.filter((ttRow: TimeTableRow) =>
            Math.abs(representIntTime(ttRow.scheduledArrivalObject) - currentHourSort) <= 130 / zoom), "trainNoLocal"),
        [currentHourSort, timetable, zoom]);

    React.useEffect(() => { // This code is probably for refreshing the whole graph every 10 seconds. There might be a more straightforward way to do this. (At first glance, this seems like changing the Date object to same value again and again.)
        setServerTimeObject(nowUTC(serverTime));
    }, [serverTime])

    React.useEffect(() => {
        const gottenPostConfig = postConfig[post];
        if (!post || !gottenPostConfig.graphConfig?.pre || !gottenPostConfig.graphConfig?.post || !serverCode) return;
        const onScreenPosts = [...gottenPostConfig.graphConfig.pre, ...gottenPostConfig.graphConfig.post];
        const postsToCalculatePath = [...gottenPostConfig.graphConfig.pre, post, ...gottenPostConfig.graphConfig.post, ...gottenPostConfig.graphConfig.final];
        // Get all pathfinding possible paths between two stations (with intermediate stations not dispatched by players)
        const allPaths = postsToCalculatePath.reduce((acc, iteratingPost, index) => {
            const prevPost = index > 0 ? postsToCalculatePath[index - 1] : undefined;
            const nextPost = index < postsToCalculatePath.length - 1 ? postsToCalculatePath[index + 1] : undefined;
            const maybeLineTraceAndDistancePrevious = prevPost
                ? PathFinding_FindPathAndHaversineSum(prevPost, iteratingPost)
                : undefined;
            const maybeLineTraceAndDistanceNext = nextPost
                ? PathFinding_FindPathAndHaversineSum(iteratingPost, nextPost)
                : undefined;

            return {
                ...acc,
                [iteratingPost]: {
                    prev: maybeLineTraceAndDistancePrevious?.[0],
                    next: maybeLineTraceAndDistanceNext?.[0]
                }
            }
        }, {});

        setAllPathsOfPosts(allPaths);

        // Get timetable data
        Promise.all(onScreenPosts.map(postId => getStationTimetable(postId, serverCode)))
            .then(data => {
                return Object.fromEntries(data) ?? undefined; // This shouldn't be null or undefined in normal circumstances
            })
            .then(setNeighboursTimetables)
    }, [post, serverCode]);

    React.useEffect(() => {
        if (!neighboursTimetables || !timetableRowsWithinRange || !allPathsOfPosts) return;
        const gottenPostConfig = postConfig[post];
        if (!gottenPostConfig.graphConfig?.pre || !gottenPostConfig.graphConfig?.post) return;

        const postsToScan = [...gottenPostConfig.graphConfig!.pre, post, ...gottenPostConfig.graphConfig!.post];
        const data = postsToScan.flatMap((postId: string) => {
            const allTrainDepartures = Object.fromEntries(Object.values(timetableRowsWithinRange).map((t): [] | [string, number] => {
                const targetTrain = postId === post ? t : neighboursTimetables[postId]?.[t.trainNoLocal];
                if (!targetTrain) return [];
                const nextPost = targetTrain.toPost ? postToInternalIds[encodeURIComponent(targetTrain.toPost)]?.id : false;
                if (!nextPost) return [];
                const isTrainGoingToKatowice = !!allPathsOfPosts[postId]?.next?.find((station) => station && station?.id === nextPost)
                const targetValue = isTrainGoingToKatowice ? dateFormatter(targetTrain?.scheduledDepartureObject) : dateFormatter(targetTrain?.scheduledArrivalObject);
                return [targetTrain.trainNoLocal, makeDate(targetValue.split(":"), serverTime)]
            }))
            const allTrainArrivals = Object.fromEntries(Object.values(timetableRowsWithinRange).map((t) => {
                const targetTrain = postId === post ? t : neighboursTimetables[postId]?.[t.trainNoLocal];
                if (!targetTrain) return [];
                const nextPost = targetTrain.toPost ? postToInternalIds[encodeURIComponent(targetTrain.toPost)]?.id : false;
                if (!targetTrain || !nextPost) return [];
                const isTrainGoingToKatowice = !!allPathsOfPosts[postId]?.next?.find((station) => station && station?.id === nextPost)
                const targetValue = isTrainGoingToKatowice ? dateFormatter(targetTrain?.scheduledArrivalObject) : dateFormatter(targetTrain?.scheduledDepartureObject);
                return [targetTrain.trainNoLocal, makeDate(targetValue.split(":"), serverTime)]
            }))
            return [{
                name: postId,
                ...allTrainArrivals
            }, {
                name: postId,
                ...allTrainDepartures
            }]
        });

        setData(data);
    }, [neighboursTimetables, timetableRowsWithinRange, currentHourSort, post, allPathsOfPosts, serverTime])

    const TimeComponent = displayMode === "vertical" ? XAxis : YAxis;
    const PostComponent = displayMode === "vertical" ? YAxis : XAxis;

    return (
        <>
            <div className="text-center inline-flex items-center justify-center w-full">
                {t("EDR_GRAPH_warning")}
                <Button className="ml-4" size={'xs'} onClick={() => setDisplayMode(displayMode === "vertical" ? "horizontal" : "vertical")}>
                    {t("EDR_GRAPH_switch_axis")}
                </Button>
                <div className="inline-flex ml-8 items-center">
                    <span>Zoom:</span>
                    <Button size="xs" className="ml-1" onClick={() => setZoom(1)}>1x</Button>
                    <Button size="xs" className="ml-1" onClick={() => setZoom(2)}>2x</Button>
                    <Button size="xs" className="ml-1" onClick={() => setZoom(3)}>3x</Button>
                </div>
            </div>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart
                    layout={displayMode}
                    width={500}
                    height={300}
                    data={data}
                    margin={{
                        top: 20,
                        right: 30,
                        left: 20,
                        bottom: 5,
                    }}
                >
                    <CartesianGrid strokeDasharray="3 3" />
                    <TimeComponent data-key="time" type="number" scale="time" domain={["dataMin", "dataMax"]} tickCount={20} interval={0} tickFormatter={dateFormatter} reversed={displayMode === "horizontal"} />
                    <ReferenceLine {...displayMode === "vertical" ? { x: serverTimeObject.getTime() } : { y: serverTimeObject.getTime() }} stroke="black" strokeWidth={2} strokeOpacity={0.5} type={"dotted"} />
                    <PostComponent dataKey="name" type="category" allowDuplicatedCategory={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    {Object.values(timetableRowsWithinRange).map((t) => {
                        const color = configByType[t.trainType]?.graphColor ?? "purple"
                        return <Line key={t.trainNoLocal} dataKey={t.trainNoLocal}
                            label={CustomizedAxisTick(data, displayMode, color)}
                            fillOpacity={0.8}
                            stroke={color}>
                        </Line>
                    }
                    )}
                </LineChart>
            </ResponsiveContainer>
        </>
    );
}

// A new graph code based on train timetable. This code is WET because I wrote this while drinking a beer. It is a delicious spaghetti.
// We need to test if the time comparison works properly around midnight. (I'm not sure how date in the game works, outside time)
const GraphContent: React.FC<GraphProps> = ({ timetable, post, serverTime, serverCode }) => {
    const [refreshValue, setRefreshValue] = React.useState<boolean>(false); // Flag used for periodical refresh of the graph. This is to center current time on the graph.
    const [btnForceRefresh, setBtnForceRefresh] = React.useState<boolean>(false); // Flag for forcing refresh of the base train number
    const [baseTrainNumber, setBaseTrainNumber] = React.useState<string>("PENDING");
    const [stationCodes, setStationCodes] = React.useState<Dictionary<number>>(); // Station codes are used for finding the next station in the timetable
    const [zoom, setZoom] = React.useState<number>(1);
    const [serverTimeObject, setServerTimeObject] = React.useState(nowUTC(serverTime));
    const currentHourSort = representIntTime(serverTimeObject);
    const [consideredTimetable, setConsideredTimetable] = React.useState<Dictionary<Dictionary<TimeTableRow>>>();
    const { t } = useTranslation();

    const getStationIdentifierFromNumber = (number: number) => {
        if(!stationCodes) return undefined;
        return Object.entries(stationCodes).find((v) => v[1] === number)?.[0];
    }

    // periodical refresh of the graph
    React.useEffect(() => {
        var intId = setInterval(() => {
            setRefreshValue(!refreshValue);
        }, 10000);
        return () => clearInterval(intId);
    })

    // Conversion of server time to Date object
    React.useEffect(() => {
        setServerTimeObject(nowUTC(serverTime));
    }, [serverTime])

    // Downloading station codes
    React.useEffect(() => {
        getStationCodes().then((v) => {
            setStationCodes(v);
            setRefreshValue(!refreshValue);
        });
    }, [])

    React.useEffect(() => {
        // Set the base train number to the most appropriate train number
        // In this case, the system will choose the next train to depart from the station
        if (!timetable || !serverTimeObject || !stationCodes) return;

        const sortedTimetable = timetable.sort((a, b) => {
            return a.scheduledDepartureObject.getTime() - b.scheduledDepartureObject.getTime();
        });
        for (let i = 0; i < sortedTimetable.length; i++) {
            if (sortedTimetable[i].scheduledDepartureObject.getTime() > serverTimeObject.getTime()) {
                setBaseTrainNumber(sortedTimetable[i].trainNoLocal);
                return;
            }
        }
    }, [post, serverCode, btnForceRefresh, stationCodes])

    React.useEffect(() => {
        // Reload the timetable when the base train number changes
        if (baseTrainNumber === "PENDING" || !serverCode || !stationCodes) return;
        // baseTrainNumber not is in the timetable. Find a new base train number.
        if (!timetable.some((v) => v.trainNoLocal === baseTrainNumber)) {
            setBtnForceRefresh(!btnForceRefresh);
            return;
        }

        let trainObj = timetable.find((v) => v.trainNoLocal === baseTrainNumber);
        if (!trainObj) return;

        (async () => {
            /**
             * [offset, postId, rows, rowForTrain]
             */
            let record: [number, string, TimeTableRow[], TimeTableRow][] = [];

            record.push([0, post, timetable, trainObj]);

            const pushRecord = async (offset: number, postId: string): Promise<boolean> => {
                console.log("pushRecord", offset, postId);
                let tt = await getTimetable(postId, serverCode)
                if (!tt) return false;
                let train = tt.find((v) => v.trainNoLocal === baseTrainNumber);
                if (!train) return false;
                let insertAt = 0;
                if(offset > 0) insertAt = record.length;
                record.splice(insertAt, 0, [offset, postId, tt, train]);
                return true;
            }

            // Try our best to show at least seven posts around the current post
            let stopBrowsingBackward = false;
            let stopBrowsingForward = false;
            while (record.length < 7) {
                let first = record[0]; let last = record[record.length - 1];
                if (!first[3].fromPostId && !last[3].toPostId) break; // No more posts to add
                if (stopBrowsingBackward && stopBrowsingForward) break;

                if (last[3].toPostId && !stopBrowsingForward) {
                    let sid = getStationIdentifierFromNumber(parseInt(last[3].toPostId)); // parseInt never fails
                    if(!sid) {
                        stopBrowsingForward = true;
                        continue;
                    }
                    if (!await pushRecord(last[0] + 1, sid)) {
                        stopBrowsingForward = true;
                    }
                }

                if (record.length >= 7) break; // Prevent count from reaching 8 in an edge case (not sure if it's possible)

                if (first[3].fromPostId && !stopBrowsingBackward) {
                    let sid = getStationIdentifierFromNumber(parseInt(first[3].fromPostId)); // parseInt never fails
                    if(!sid) {
                        stopBrowsingBackward = true;
                        continue;
                    }
                    if (!await pushRecord(first[0] - 1, sid)) {
                        stopBrowsingBackward = true;
                    }
                }
            }

            // Let's print the record for debugging purposes
            console.log(record);
        })();
    }, [baseTrainNumber, post, serverCode, btnForceRefresh])

    return <></>
}

export default React.memo(GraphContent)
