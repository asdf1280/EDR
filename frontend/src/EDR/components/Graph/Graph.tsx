import { format } from "date-fns";
import { Button } from "flowbite-react";
import _sortBy from "lodash/sortBy";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useDarkMode } from "usehooks-ts";
import { getTimetable, getTrainTimetable } from "../../../api/api";
import { configByType } from "../../../config/trains";
import { TimeTableRow } from "../../../customTypes/TimeTableRow";
import { nowUTC } from "../../../utils/date";

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
    distance: number;
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

    if (percent >= 0 && percent <= 1) {
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
    const [refreshValue, setRefreshValue] = React.useState<number>(Date.now()); // Flag used for periodical refresh of the graph. This is to center current time on the graph.
    const [btnForceRefresh, setBtnForceRefresh] = React.useState<boolean>(false); // Flag for forcing refresh of the base train number
    const [baseTrainNumber, setBaseTrainNumber] = React.useState<string>("PENDING");
    const [zoom, setZoom] = React.useState<number>(1);
    const [serverTimeObject, setServerTimeObject] = React.useState(nowUTC(serverTime));
    const [serverTimeSetAt, setServerTimeSetAt] = React.useState<number>(Date.now());
    const currentServerTime = serverTimeObject.getTime() + Date.now() - serverTimeSetAt;
    const { t } = useTranslation();
    const { isDarkMode } = useDarkMode();
    const graphCanvasRef = React.useRef<HTMLCanvasElement>(null);
    const timetableCache = React.useRef<Record<number, TimeTableRow[]>>({});
    const [graphData, setGraphData] = React.useState<GraphData | null>(null);

    // periodical refresh of the graph
    React.useEffect(() => {
        var intId = setInterval(() => {
            setRefreshValue(Date.now());
        }, 10000);
        return () => clearInterval(intId);
    }, [])

    // Conversion of server time to Date object
    React.useEffect(() => {
        setServerTimeObject(nowUTC(serverTime));
        setServerTimeSetAt(Date.now());
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
            // Download train timetable first
            let trainPlan = await getTrainTimetable(baseTrainNumber, serverCode);

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
            while (record.length < 5) {
                let first = record[0]; let last = record[record.length - 1];
                if (!first[3].fromPostId && !last[3].toPostId) break; // No more posts to add
                if (stopBrowsingBackward && stopBrowsingForward) break;

                if (last[3].toPostId && !stopBrowsingForward) {
                    if (!await pushRecord(last[0] + 1, parseInt(last[3].toPostId))) {
                        stopBrowsingForward = true;
                    }
                }

                if (record.length >= 5) break; // Prevent count from reaching 8 in an edge case (not sure if it's possible)

                if (first[3].fromPostId && !stopBrowsingBackward) {
                    if (!await pushRecord(first[0] - 1, parseInt(first[3].fromPostId))) {
                        stopBrowsingBackward = true;
                    }
                }
            }

            const stationReversed = parseInt(baseTrainNumber) % 2 === 0;
            if (stationReversed) record = record.reverse();

            // Time to really calculate train routes
            let timeRange = 35 * 60 * 1000 / zoom; // 35 minutes
            let dataObj: GraphData = {
                timeSince: new Date(currentServerTime - timeRange),
                timeUntil: new Date(currentServerTime + timeRange * 3),
                posts: [],
                lines: []
            };
            let lines = dataObj.lines;
            let posts = dataObj.posts;

            let sumOfValidDistance = [0, 0];

            for (let postIndex = 0; postIndex < record.length; postIndex++) {
                let post = record[postIndex];

                let distance: number = -1;
                if(postIndex === 0) distance = 0;
                else {
                    let prevStop = trainPlan.find((v) => v.pointId === "" + record[postIndex - 1][1]);
                    let thisStop = trainPlan.find((v) => v.pointId === "" + post[1]);

                    if(thisStop && prevStop) {
                        if(prevStop.line === thisStop.line) {
                            distance = Math.abs(thisStop.mileage - prevStop.mileage);
                            sumOfValidDistance = [sumOfValidDistance[0] + 1, sumOfValidDistance[1] + distance];
                        }
                    }
                }

                // Save post name
                posts.push({ name: offsetAndStationNames[post[0] * (stationReversed ? 1 : 1)], distance: distance });

                for (let rowIndex = 0; rowIndex < post[2].length; rowIndex++) {
                    const row = post[2][rowIndex];

                    if (row.scheduledDepartureObject.getTime() < dataObj.timeSince.getTime()
                        && row.scheduledArrivalObject.getTime() > dataObj.timeUntil.getTime() && row.scheduledArrivalObject.getTime() !== 0) {
                        // Irrelevant train
                        continue;
                    }

                    // The code below determines how to save the train's movement to the graph data.
                    let trainInLines = lines.filter((v) => v.id.startsWith(row.trainNoLocal + "_"))
                    let createNewLineName: string | null = null;
                    let appendToLineName: string | null = null;
                    if (trainInLines.length > 0) {
                        // Check if there's a discontinuity
                        let lastLineOfTrain = trainInLines[trainInLines.length - 1];
                        let lastNode = lastLineOfTrain.nodes[lastLineOfTrain.nodes.length - 1];
                        if (lastNode.yStation == postIndex - 1 || lastNode.yStation == postIndex + 1) { // Continuous route. Append to the last line.
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
                                yStation: postIndex,
                                yTrack: 0
                            }
                        ]
                    } else if (row.stopType === 1) { // Required stop
                        nodes = [
                            {
                                x: row.scheduledArrivalObject.getTime(),
                                yStation: postIndex,
                                yTrack: row.track ?? 0,
                                stopType: 1
                            },
                            {
                                x: row.scheduledDepartureObject.getTime(),
                                yStation: postIndex,
                                yTrack: row.track ?? 0
                            }
                        ]
                    } else if (row.stopType === 2) { // Optional stop
                        nodes = [
                            {
                                x: row.scheduledArrivalObject.getTime(),
                                yStation: postIndex,
                                yTrack: row.track ?? 0,
                                stopType: 2
                            },
                            {
                                x: row.scheduledDepartureObject.getTime(),
                                yStation: postIndex,
                                yTrack: row.track ?? 0
                            }
                        ]
                    }

                    // The actual code to save to train data.
                    if (createNewLineName) {
                        lines.push({
                            color: configByType[row.trainType]?.graphColor ?? (isDarkMode ? "#ff5c5c" : "#ad0000"),
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

            if(sumOfValidDistance[0] === 0) {
                sumOfValidDistance = [1, 1];
            }
            posts.forEach((v) => {
                if(v.distance === -1) v.distance = sumOfValidDistance[1] / sumOfValidDistance[0]; // If distance is not provided, we will assume the average distance.
            })

            // Now, sort all nodes of each line by x
            for (let line of lines) {
                let nodes = line.nodes;
                nodes = _sortBy(nodes, (v) => v.x);

                for (let i = 0; i < nodes.length - 2; i++) {
                    if (nodes[i].x === nodes[i + 1].x && Math.sign(nodes[i + 1].yStation - nodes[i + 2].yStation) !== Math.sign(nodes[i].yStation - nodes[i + 1].yStation)) {
                        // swap
                        [nodes[i], nodes[i + 1]] = [nodes[i + 1], nodes[i]];
                    }
                    if (nodes[i + 1].x === nodes[i + 2].x && Math.sign(nodes[i + 1].yStation - nodes[i + 2].yStation) !== Math.sign(nodes[i].yStation - nodes[i + 1].yStation)) {
                        // swap
                        [nodes[i + 2], nodes[i + 1]] = [nodes[i + 1], nodes[i + 2]];
                    }
                }

                line.nodes = nodes;
            }

            setGraphData(dataObj);
        })();
    }, [baseTrainNumber, post, serverCode, btnForceRefresh, zoom, refreshValue])

    useEffect(() => {
        let listener = () => {
            if (graphCanvasRef.current) {
                let bcr = graphCanvasRef.current.getBoundingClientRect();
                graphCanvasRef.current.width = bcr.width * (window.devicePixelRatio || 1);
                graphCanvasRef.current.height = bcr.height * (window.devicePixelRatio || 1);
                setRefreshValue(Date.now());
            }
        }
        listener();
        window.addEventListener("resize", listener);
        return () => window.removeEventListener("resize", listener);
    }, []);

    // Rendering the graph. Possibly this should be separated.
    useEffect(() => {
        if (!graphCanvasRef.current) return;
        if (!graphData) return;
        const canvas = graphCanvasRef.current;
        const data = graphData;
        const ctx = canvas.getContext("2d");
        const cell = window.devicePixelRatio || 1;
        if (!ctx) return;

        const ForeColor = isDarkMode ? "white" : "black";
        const GridColor = isDarkMode ? "#5c5c5c" : "#cccccc";

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let gx = Math.min(canvas.width * 0.15, cell * 200);
        let gy = canvas.height * 0.1;
        let gw = canvas.width - gx * 2;
        let gh = canvas.height * 0.9 - Math.min(canvas.height * 0.15, cell * 200);
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
            let distanceSum = data.posts.reduce((acc, v) => acc + v.distance, 0);
            let stationPos = 0;
            for(let i = 1; i <= yStation; i++) {
                stationPos += data.posts[i].distance;
            }

            let trackOffset: number;
            if (yTrack == 0) trackOffset = 0;
            else if (yTrack % 2 == 0) trackOffset = -15 * cell;
            else trackOffset = 15 * cell;
            return gy + gh * stationPos / distanceSum + trackOffset;
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
                ctx.save()
                ctx.strokeStyle = GridColor;
                ctx.lineWidth = 1 * cell;
                ctx.setLineDash([2 * cell, 2 * cell]);
                ctx.beginPath();
                ctx.moveTo(gx, y);
                ctx.lineTo(gx + gw, y);
                ctx.stroke();

                // Draw post label, 45 degree rotated
                ctx.translate(gwl, y + 12 * cell);
                ctx.rotate(-Math.PI / 4);
                ctx.font = `${22 * cell}px 'Open Sans'`;
                ctx.textAlign = "right";
                ctx.fillStyle = ForeColor;
                // make sure text doesn't go out of the canvas
                let sz = ctx.measureText(post.name);
                if ((sz.width + sz.actualBoundingBoxAscent) / Math.sqrt(2) > gwl * 0.85) {
                    let newSize = 22 * cell / ((sz.width + sz.actualBoundingBoxAscent) / Math.sqrt(2) / (gwl * 0.85));
                    ctx.font = `${newSize}px 'Open Sans'`;
                }
                ctx.fillText(post.name, 0, -6 * cell);
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
                ctx.save();
                ctx.strokeStyle = GridColor;
                ctx.lineWidth = 1 * cell;
                ctx.setLineDash([2 * cell, 2 * cell]);
                ctx.beginPath();
                ctx.moveTo(x, gy);
                ctx.lineTo(x, gy + gh);
                ctx.stroke();

                // Draw time label, 45 degree rotated
                ctx.translate(x, gy + gh);
                ctx.font = `${32 * cell}px 'Open Sans'`;
                ctx.textAlign = "center";
                ctx.fillStyle = ForeColor;
                // make sure text doesn't go out of the canvas
                let sz = ctx.measureText(formattedTime);
                if ((sz.width + sz.actualBoundingBoxAscent) / Math.sqrt(2) > ghl) {
                    let newSize = 32 * cell / ((sz.width + sz.actualBoundingBoxAscent) / Math.sqrt(2) / ghl);
                    ctx.font = `${newSize}px 'Open Sans'`;
                }
                ctx.fillText(formattedTime, 0, 50 * cell);
                ctx.restore();
            }
        }

        // Draw train lines
        {
            for (let line of data.lines) {
                ctx.strokeStyle = line.color;
                ctx.lineCap = "round";

                let lastNode = line.nodes[0];
                let lastX = calculateX(lastNode.x);
                let lastY = calculateY(lastNode.yStation, lastNode.yTrack);

                let firstX = null;
                let firstY = null;

                for (let node of line.nodes) {
                    let x = calculateX(node.x);
                    let y = calculateY(node.yStation, node.yTrack);

                    if (x < gx) {
                        lastX = x;
                        lastY = y;
                        continue;
                    }
                    else if (lastX < gx) {
                        // Interpolate the first point at gx
                        let ratio = (gx - lastX) / (x - lastX);
                        lastY = lastY + ratio * (y - lastY);
                        lastX = gx;
                    }

                    if (lastX >= gx + gw) {
                        break;
                    } if (x > gx + gw) {
                        // Interpolate the last point at gx + gw
                        let ratio = (gx + gw - lastX) / (x - lastX);
                        y = lastY + ratio * (y - lastY);
                        x = gx + gw;
                    }

                    if (firstX === null) {
                        firstX = lastX;
                        firstY = lastY;
                    }

                    if (line.name !== baseTrainNumber)
                        ctx.lineWidth = 4 * cell;
                    else
                        ctx.lineWidth = 8 * cell;
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

                // Drawing train ID above first node start
                if (firstX) {
                    ctx.save();
                    ctx.translate(firstX, firstY ?? gy);
                    ctx.textAlign = "left";
                    if (line.name !== baseTrainNumber)
                        ctx.font = `${12 * cell}px 'Open Sans'`;
                    else
                        ctx.font = `${16 * cell}px 'Open Sans'`;
                    ctx.fillStyle = ForeColor;
                    let offset = 18 * cell + parseInt(line.name) % 3 * 12 * cell;
                    if (parseInt(line.name) % 2 === 1) offset *= -1;
                    ctx.fillText(line.name, 0, offset);
                    ctx.restore();
                }
            }
        }

        // Draw current time
        {
            ctx.strokeStyle = isDarkMode ? "#ff5c5c" : "#ad0000"
            ctx.lineWidth = 2 * cell;
            let x = calculateX(currentServerTime);

            ctx.beginPath();
            ctx.moveTo(x, gy - 10 * cell);
            ctx.lineTo(x, gy + gh + 10 * cell);
            ctx.stroke();
        }

        const onCanvasClick = (e: MouseEvent) => {
            let bcr = canvas.getBoundingClientRect();
            let cxP = (e.clientX - bcr.left) / bcr.width * canvas.width;
            let cyP = (e.clientY - bcr.top) / bcr.height * canvas.height;

            let m: [number, GraphLine][] = data.lines.map((v) => {
                let dist = Infinity;
                if (v.nodes.length === 1) {
                    let node = v.nodes[0];
                    return [Math.sqrt((calculateX(node.x) - cxP) ** 2 + (calculateY(node.yStation, node.yTrack) - cyP) ** 2), v];
                }
                for (let i = 1; i < v.nodes.length; i++) {
                    let nDist = calculatePointToLineDistance(calculateX(v.nodes[i - 1].x),
                        calculateY(v.nodes[i - 1].yStation, v.nodes[i - 1].yTrack),
                        calculateX(v.nodes[i].x),
                        calculateY(v.nodes[i].yStation, v.nodes[i].yTrack), cxP, cyP);
                    dist = Math.min(dist, nDist);
                }
                return [dist, v];
            });
            m = _sortBy(m, (v) => v[0]);

            // alert(JSON.stringify(m[0]))
            let newTrainId = m[0][1].name;
            if (baseTrainNumber !== newTrainId)
                setBaseTrainNumber(newTrainId);
        }
        canvas.addEventListener("click", onCanvasClick);
        return () => canvas.removeEventListener("click", onCanvasClick);
    }, [graphData, refreshValue])

    return <>
        <div className="text-center inline-flex items-center justify-center w-full">
            {t("EDR_GRAPH_warning")}
            <div className="inline-flex ml-8 items-center">
                <span>Zoom:</span>
                <Button size="xs" className="ml-1" onClick={() => setZoom(0.05)}>0.05x (debug)</Button>
                <Button size="xs" className="ml-1" onClick={() => setZoom(0.5)}>0.5x</Button>
                <Button size="xs" className="ml-1" onClick={() => setZoom(1)}>1x</Button>
                <Button size="xs" className="ml-1" onClick={() => setZoom(2)}>2x</Button>
                <Button size="xs" className="ml-1" onClick={() => setZoom(3)}>3x</Button>
            </div>
        </div>
        <canvas className="w-full h-full" style={{ flexBasis: 0, flexGrow: 1 }} ref={graphCanvasRef}></canvas>
    </>
}

export default React.memo(GraphContent)
