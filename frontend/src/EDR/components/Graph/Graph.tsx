import React, { useEffect } from "react";
import { nowUTC } from "../../../utils/date";
import { getTimetable } from "../../../api/api";
import _keyBy from "lodash/keyBy";
import { format } from "date-fns";
import _sortBy from "lodash/sortBy";
import { Button } from "flowbite-react";
import { useTranslation } from "react-i18next";
import { TimeTableRow } from "../../../customTypes/TimeTableRow";
import { configByType } from "../../../config/trains";
import { useDarkMode } from "usehooks-ts";

export type GraphProps = {
    post: string;
    timetable: TimeTableRow[];
    serverTime: number | undefined;
    serverCode: string | undefined;
}

const dateFormatter = (date: Date) => {
    return format(date, "HH:mm");
};

export type GraphPoint = {
    x: number;
    yStation: number;
    yTrack: number;
    stopType?: number;
}

export type GraphLine = {
    id: string;
    name: string;
    color: string;
    nodes: GraphPoint[];
}

export type GraphPost = {
    name: string;
}

export type GraphData = {
    timeSince: Date;
    timeUntil: Date;
    posts: GraphPost[];
    lines: GraphLine[];
}

const calculatePointToLineDistance = (x1: number, y1: number, x2: number, y2: number, px: number, py: number) => {
    // Let's say A is line from (x1, y1) to (x2, y2), B is line from (x1, y1) to (px, py)
    // According to the scala product, there T is angle between A and B
    // AB cos T = AxBx + AyBy

    let A = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    if (A == 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);

    // The percent of projected position is represented as,
    // B cos T / A = (AxBx + AyBy) / A^2

    let percent = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / (A ** 2);

    if (percent >= 0 && percent <= 0) {
        let projectedX = x1 + (x2 - x1) * percent;
        let projectedY = y1 + (y2 - y1) * percent;
        return Math.sqrt((px - projectedX) ** 2 + (py - projectedY) ** 2);
    } else if (percent < 0) {
        return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    } else {
        return Math.sqrt((px - x2) ** 2 + (py - y2) ** 2);
    }
}

// A new graph code based on train timetable. This code is WET because I wrote this while drinking a beer. It is a delicious spaghetti.
// We need to test if the time comparison works properly around midnight. (I'm not sure how date in the game works, outside time)
const GraphContent: React.FC<GraphProps> = ({ timetable, post, serverTime, serverCode }) => {
    const [refreshValue, setRefreshValue] = React.useState<boolean>(false); // Flag used for periodical refresh of the graph. This is to center current time on the graph.
    const [btnForceRefresh, setBtnForceRefresh] = React.useState<boolean>(false); // Flag for forcing refresh of the base train number
    const [baseTrainNumber, setBaseTrainNumber] = React.useState<string>("PENDING");
    const [zoom, setZoom] = React.useState<number>(1);
    const [serverTimeObject, setServerTimeObject] = React.useState(nowUTC(serverTime));
    const { t } = useTranslation();
    const { isDarkMode } = useDarkMode();
    const graphCanvasRef = React.useRef<HTMLCanvasElement>(null);
    const timetableCache = React.useRef<Record<number, TimeTableRow[]>>({});
    const graphDataRef = React.useRef<GraphData | null>(null);

    // periodical refresh of the graph
    React.useEffect(() => {
        var intId = setInterval(() => {
            setRefreshValue(!refreshValue);
        }, 10000);
        return () => clearInterval(intId);
    }, [])

    // Conversion of server time to Date object
    React.useEffect(() => {
        setServerTimeObject(nowUTC(serverTime));
    }, [serverTime])

    React.useEffect(() => {
        // Set the base train number to the most appropriate train number
        // In this case, the system will choose the next train to depart from the station
        if (!timetable || !serverTimeObject) return;

        const sortedTimetable = timetable.sort((a, b) => {
            return a.scheduledDepartureObject.getTime() - b.scheduledDepartureObject.getTime();
        });
        for (let i = 0; i < sortedTimetable.length; i++) {
            if (sortedTimetable[i].scheduledDepartureObject.getTime() > serverTimeObject.getTime()) {
                setBaseTrainNumber(sortedTimetable[i].trainNoLocal);
                return;
            }
        }
    }, [post, serverCode, btnForceRefresh])

    React.useEffect(() => {
        // Reload the timetable when the base train number changes
        if (baseTrainNumber === "PENDING" || !serverCode) return;
        // baseTrainNumber not is in the timetable. Find a new base train number.
        if (!timetable.some((v) => v.trainNoLocal === baseTrainNumber)) {
            setBtnForceRefresh(!btnForceRefresh);
            return;
        }

        let trainObj = timetable.find((v) => v.trainNoLocal === baseTrainNumber);
        if (!trainObj) return;

        // let c = configByType[trainObj.trainType].graphColor;

        (async () => {
            /**
             * [offset, postId, rows, rowForTrain]
             */
            let record: [number, number, TimeTableRow[], TimeTableRow][] = [];
            /**
             * The station name isn't provided for the current post, so we have to supply it from other posts.
             */
            let offsetAndStationNames: Record<number, string> = {};

            record.push([0, parseInt(trainObj.pointId), timetable, trainObj]);
            offsetAndStationNames[0] = post; // Unable to get the full name of the current post, so we have to use the post code for now.
            offsetAndStationNames[1] = trainObj.toPost ?? "UNKNOWN";
            offsetAndStationNames[-1] = trainObj.fromPost ?? "UNKNOWN";

            const pushRecord = async (offset: number, postId: number): Promise<boolean> => {
                console.log("pushRecord", offset, postId);
                let tt: TimeTableRow[];
                if (timetableCache.current[postId])
                    tt = timetableCache.current[postId];
                else {
                    tt = await getTimetable(postId, serverCode)
                    timetableCache.current[postId] = tt;
                }
                if (!tt) return false;
                let train = tt.find((v) => v.trainNoLocal === baseTrainNumber);
                if (!train) return false;
                let insertAt = 0;
                if (offset > 0) insertAt = record.length;
                record.splice(insertAt, 0, [offset, postId, tt, train]);
                offsetAndStationNames[offset - 1] = train.fromPost ?? "UNKNOWN";
                offsetAndStationNames[offset + 1] = train.toPost ?? "UNKNOWN";
                return true;
            }

            // Try our best to show at least seven posts around the current post, if the selected train has enough stations.
            // This might even only have one post.

            // This code depends on post codes. This caused stations outside player-dispatched area to be ignored. I need to change backend code to support Simrail internal ID for retrieving timetable.
            let stopBrowsingBackward = false;
            let stopBrowsingForward = false;
            while (record.length < 7) {
                let first = record[0]; let last = record[record.length - 1];
                if (!first[3].fromPostId && !last[3].toPostId) break; // No more posts to add
                if (stopBrowsingBackward && stopBrowsingForward) break;

                if (last[3].toPostId && !stopBrowsingForward) {
                    if (!await pushRecord(last[0] + 1, parseInt(last[3].toPostId))) {
                        stopBrowsingForward = true;
                    }
                }

                if (record.length >= 7) break; // Prevent count from reaching 8 in an edge case (not sure if it's possible)

                if (first[3].fromPostId && !stopBrowsingBackward) {
                    if (!await pushRecord(first[0] - 1, parseInt(first[3].fromPostId))) {
                        stopBrowsingBackward = true;
                    }
                }
            }

            // Let's print the record for debugging purposes
            console.log(record);
            console.log(offsetAndStationNames);

            // Time to really calculate train routes
            let timeRange = 35 * 60 * 1000 / zoom; // 35 minutes
            let dataObj: GraphData = {
                timeSince: new Date(serverTimeObject.getTime() - timeRange),
                timeUntil: new Date(serverTimeObject.getTime() + timeRange * 3),
                posts: [],
                lines: []
            };
            let lines = dataObj.lines;
            let posts = dataObj.posts;

            for (let post of record) {
                // Save post name
                posts.push({ name: offsetAndStationNames[post[0]] });

                for (let i = 0; i < post[2].length; i++) {
                    const row = post[2][i];

                    if (row.scheduledDepartureObject.getTime() < dataObj.timeSince.getTime() - 60000
                        && row.scheduledArrivalObject.getTime() > dataObj.timeUntil.getTime() + 60000) {
                        // Irrelevant train
                        continue;
                    }

                    // The code below determines how to save the train's movement to the graph data.
                    let trainInLines = lines.filter((v) => v.id.startsWith(row.trainNoLocal + "_"))
                    let createNewLineName: string | null = null;
                    let appendToLineName: string | null = null;
                    if (trainInLines) {
                        // Check if there's a discontinuity
                        let lastLineOfTrain = trainInLines[trainInLines.length - 1];
                        let lastNode = lastLineOfTrain.nodes[lastLineOfTrain.nodes.length - 1];
                        if (lastNode.yStation == i - 1) { // Continuous route. Append to the last line.
                            appendToLineName = lastLineOfTrain.id;
                        } else { // Discontinuous route. Create a new line for the same train.
                            let lastLineNo = parseInt(lastLineOfTrain.id.split("_")[1]);
                            createNewLineName = row.trainNoLocal + "_" + (lastLineNo + 1);
                        }
                    } else {
                        createNewLineName = row.trainNoLocal + "_0";
                    }

                    // Prepare nodes to append
                    let nodes: GraphPoint[] = [];
                    if (row.stopType === 0) { // Pass
                        nodes = [
                            {
                                x: row.scheduledDepartureObject.getTime(),
                                yStation: i,
                                yTrack: 0
                            }
                        ]
                    } else if (row.stopType === 1) { // Required stop
                        nodes = [
                            {
                                x: row.scheduledArrivalObject.getTime(),
                                yStation: i,
                                yTrack: row.track ?? 0,
                                stopType: 1
                            },
                            {
                                x: row.scheduledDepartureObject.getTime(),
                                yStation: i,
                                yTrack: row.track ?? 0
                            }
                        ]
                    } else if (row.stopType === 2) { // Optional stop
                        nodes = [
                            {
                                x: row.scheduledArrivalObject.getTime(),
                                yStation: i,
                                yTrack: row.track ?? 0,
                                stopType: 2
                            },
                            {
                                x: row.scheduledDepartureObject.getTime(),
                                yStation: i,
                                yTrack: row.track ?? 0
                            }
                        ]
                    }

                    // The actual code to save to train data.
                    if (createNewLineName) {
                        lines.push({
                            color: configByType[row.trainType].graphColor,
                            id: createNewLineName,
                            name: row.trainNoLocal,
                            nodes
                        })
                    } else {
                        let line = lines.find((v) => v.id === appendToLineName)!;
                        line.nodes.push(...nodes)
                    }
                }
            }

            graphDataRef.current = dataObj;
        })();
    }, [baseTrainNumber, post, serverCode, btnForceRefresh])

    useEffect(() => {
        let listener = () => {
            if (graphCanvasRef.current) {
                let bcr = graphCanvasRef.current.getBoundingClientRect();
                graphCanvasRef.current.width = bcr.width * (window.devicePixelRatio || 1);
                graphCanvasRef.current.height = bcr.height * (window.devicePixelRatio || 1);
            }
        }
        listener();
        window.addEventListener("resize", listener);
        return () => window.removeEventListener("resize", listener);
    }, []);

    // Rendering the graph. Possibly this should be separated.
    useEffect(() => {
        if (!graphCanvasRef.current) return;
        if (!graphDataRef.current) return;
        const canvas = graphCanvasRef.current;
        const data = graphDataRef.current;
        const ctx = canvas.getContext("2d");
        const cell = window.devicePixelRatio || 1;
        if (!ctx) return;

        const ForeColor = isDarkMode ? "white" : "black";
        const GridColor = isDarkMode ? "#5c5c5c" : "#cccccc";

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let gx = Math.min(canvas.width * 0.15, cell * 200);
        let gy = 0;
        let gw = canvas.width - gx;
        let gh = canvas.height - Math.min(canvas.height * 0.15, cell * 200);
        let gwl = gx;
        let ghl = canvas.height - gh;

        // Draw graph frame
        ctx.strokeStyle = ForeColor;
        ctx.lineWidth = 1 * cell;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx, gy + gh);
        ctx.lineTo(gx + gw, gy + gh);
        ctx.stroke();

        const calculateY = (yStation: number, yTrack: number) => {
            let trackOffset: number;
            if (yTrack == 0) trackOffset = 0;
            else if (yTrack % 2 == 0) trackOffset = (yTrack - 1) * -8 * cell;
            else trackOffset = yTrack * 8 * cell;
            return gy + gh * (yStation + 1) / (data.posts.length + 1) + trackOffset;
        }

        const calculateX = (at: Date | number) => {
            let dateNum: number;
            if (typeof at === "number") dateNum = at;
            else dateNum = at.getTime();
            return gx + gw * (dateNum - data.timeSince.getTime()) / (data.timeUntil.getTime() - data.timeSince.getTime());
        }

        // Draw posts
        let postCount = data.posts.length;
        {
            for (let i = 0; i < postCount; i++) {
                const post = data.posts[i];
                const y = calculateY(i, 0);

                // Draw grid line
                ctx.strokeStyle = GridColor;
                ctx.lineWidth = 1 * cell;
                ctx.setLineDash([2 * cell, 2 * cell]);
                ctx.beginPath();
                ctx.moveTo(gx, y);
                ctx.lineTo(gx + gw, y);
                ctx.stroke();

                // Draw post label, 45 degree rotated
                ctx.save()
                ctx.translate(gwl, y);
                ctx.rotate(-Math.PI / 4);
                ctx.font = `${12 * cell}px`;
                ctx.textAlign = "right";
                ctx.fillStyle = ForeColor;
                // make sure text doesn't go out of the canvas
                let sz = ctx.measureText(post.name);
                if ((sz.width + sz.actualBoundingBoxAscent) / Math.sqrt(2) > ghl) {
                    let newSize = 12 * cell / ((sz.width + sz.actualBoundingBoxAscent) / Math.sqrt(2) / ghl);
                    ctx.font = `${newSize}px`;
                }
                ctx.fillText(post.name, 0, 6 * cell);
                ctx.restore();
            }
        }

        // Draw time grids
        {
            const GRID_INTERVAL = 1000 * 60 * 15;
            let timeSince = data.timeSince.getTime(); // x = 0
            let timeUntil = data.timeUntil.getTime(); // x = gw

            let initialTime = Math.ceil(timeSince / GRID_INTERVAL) * GRID_INTERVAL;
            for (let t = initialTime; t <= timeUntil; t += GRID_INTERVAL) {
                const x = calculateX(t);
                const formattedTime = dateFormatter(new Date(t));

                // Draw grid line
                ctx.strokeStyle = GridColor;
                ctx.lineWidth = 1 * cell;
                ctx.setLineDash([2 * cell, 2 * cell]);
                ctx.beginPath();
                ctx.moveTo(x, gy);
                ctx.lineTo(x, gy + gh);
                ctx.stroke();

                // Draw time label, 45 degree rotated
                ctx.save();
                ctx.translate(x, gy + gh);
                ctx.rotate(-Math.PI / 4);
                ctx.font = `${12 * cell}px`;
                ctx.textAlign = "right";
                ctx.fillStyle = ForeColor;
                // make sure text doesn't go out of the canvas
                let sz = ctx.measureText(formattedTime);
                if ((sz.width + sz.actualBoundingBoxAscent) / Math.sqrt(2) > ghl) {
                    let newSize = 12 * cell / ((sz.width + sz.actualBoundingBoxAscent) / Math.sqrt(2) / ghl);
                    ctx.font = `${newSize}px`;
                }
                ctx.fillText(formattedTime, 0, 6 * cell);
                ctx.restore();
            }
        }

        // Draw train lines, finally!
        {
            for (let line of data.lines) {
                ctx.strokeStyle = line.color;
                ctx.lineCap = "round";

                let lastNode = line.nodes[0];
                let lastX = calculateX(lastNode.x);
                let lastY = calculateY(lastNode.yStation, lastNode.yTrack);

                // Drawing train ID above first node start
                ctx.save();
                ctx.translate(lastX, lastY);
                ctx.rotate(-Math.PI / 4);
                ctx.textAlign = "left";
                if (line.name !== baseTrainNumber)
                    ctx.font = `${12 * cell}px`;
                else
                    ctx.font = `${12 * cell}px bold`;
                ctx.fillStyle = ForeColor;
                ctx.fillText(line.name, 3 * cell, 6 * cell);

                for (let node of line.nodes) {
                    let x = calculateX(node.x);
                    let y = calculateY(node.yStation, node.yTrack);

                    if (lastNode.stopType === 2) {
                        ctx.lineWidth = 6 * cell;
                    } else {
                        ctx.lineWidth = 3 * cell;
                    }
                    if (lastNode.stopType !== 1) {
                        ctx.beginPath();
                        ctx.moveTo(lastX, lastY);
                        ctx.lineTo(x, y);
                        ctx.stroke();
                    } else {
                        ctx.beginPath();
                        ctx.moveTo(lastX, lastY - 3 * cell);
                        ctx.lineTo(x, y - 3 * cell);
                        ctx.stroke();

                        ctx.beginPath();
                        ctx.moveTo(lastX, lastY + 3 * cell);
                        ctx.lineTo(x, y + 3 * cell);
                        ctx.stroke();
                    }

                    lastNode = node;
                    lastX = x;
                    lastY = y;
                }
            }
        }

        // Draw current time
        {
            ctx.strokeStyle = isDarkMode ? "#ff5c5c" : "#ad0000"
            ctx.lineWidth = 5 * cell;
            let x = calculateX(serverTimeObject);

            ctx.beginPath();
            ctx.moveTo(x, gy - 10 * cell);
            ctx.lineTo(x, gy + gh + 10 * cell);
            ctx.stroke();
        }

        const onCanvasClick = (e: MouseEvent) => {
            let bcr = canvas.getBoundingClientRect();
            let cxP = (e.clientX - bcr.left) / bcr.width;
            let cyP = (e.clientY - bcr.top) / bcr.height;

            let m: [number, GraphLine][] = data.lines.map((v) => {
                let dist = Infinity;
                for (let i = 1; i < v.nodes.length; i++) {
                    let nDist = calculatePointToLineDistance(calculateX(v.nodes[i - 1].x) / canvas.width,
                        calculateY(v.nodes[i - 1].yStation, v.nodes[i - 1].yTrack) / canvas.height,
                        calculateX(v.nodes[i].x) / canvas.width,
                        calculateY(v.nodes[i].yStation, v.nodes[i].yTrack) / canvas.height, cxP, cyP);
                    dist = Math.min(dist, nDist);
                }
                return [dist, v];
            });
            m = _sortBy(m, (v) => v[0]);

            let newTrainId = m[0][1].name;
            if (baseTrainNumber !== newTrainId)
                setBaseTrainNumber(newTrainId);
        }
        canvas.addEventListener("click", onCanvasClick);
        return () => canvas.removeEventListener("click", onCanvasClick);
    })

    return <>
        <div className="text-center inline-flex items-center justify-center w-full">
            {t("EDR_GRAPH_warning")}
            <div className="inline-flex ml-8 items-center">
                <span>Zoom:</span>
                <Button size="xs" className="ml-1" onClick={() => setZoom(1)}>1x</Button>
                <Button size="xs" className="ml-1" onClick={() => setZoom(2)}>2x</Button>
                <Button size="xs" className="ml-1" onClick={() => setZoom(3)}>3x</Button>
            </div>
        </div>
        <canvas className="w-full h-full" ref={graphCanvasRef}></canvas>
    </>
}

export default React.memo(GraphContent)
