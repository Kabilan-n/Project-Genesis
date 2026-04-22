"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MapGenerator = void 0;
class MapGenerator {
    generate(worldId, size) {
        const tiles = [];
        const noise = this.buildNoise(size);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const n = noise[y][x];
                const terrain = this.terrainFromNoise(n, x, y, size);
                tiles.push({
                    world_id: worldId,
                    x,
                    y,
                    terrain,
                    is_passable: terrain !== 'water' && terrain !== 'mountain',
                    resources: {},
                });
            }
        }
        const resourceNodes = this.placeResourceNodes(worldId, tiles, size);
        return { tiles, resourceNodes };
    }
    buildNoise(size) {
        const grid = [];
        // Simple diamond-square-ish noise using sine waves
        for (let y = 0; y < size; y++) {
            grid[y] = [];
            for (let x = 0; x < size; x++) {
                const nx = x / size - 0.5;
                const ny = y / size - 0.5;
                let v = 0;
                v += Math.sin(nx * 6) * 0.4;
                v += Math.sin(ny * 7) * 0.3;
                v += Math.sin((nx + ny) * 9) * 0.2;
                v += Math.sin((nx - ny) * 5) * 0.1;
                // normalize -1..1 → 0..1
                grid[y][x] = (v + 1) / 2;
            }
        }
        return grid;
    }
    terrainFromNoise(n, x, y, size) {
        // Water at edges and low areas
        const distFromEdge = Math.min(x, y, size - 1 - x, size - 1 - y) / (size * 0.1);
        const adjusted = n * Math.min(1, distFromEdge);
        if (adjusted < 0.15)
            return 'water';
        if (adjusted < 0.25)
            return 'swamp';
        if (adjusted < 0.45)
            return 'grassland';
        if (adjusted < 0.65)
            return 'forest';
        if (adjusted < 0.80)
            return 'grassland';
        return 'mountain';
    }
    placeResourceNodes(worldId, tiles, size) {
        const nodes = [];
        const passable = tiles.filter(t => t.is_passable);
        const configs = [
            { resource_type: 'food', count: 12, extraction_rate: 8, regen_rate: 0.3, max_capacity: 200, terrain_pref: ['forest', 'grassland'] },
            { resource_type: 'water', count: 8, extraction_rate: 20, regen_rate: 2.0, max_capacity: 500, terrain_pref: ['swamp', 'grassland'] },
            { resource_type: 'wood', count: 10, extraction_rate: 5, regen_rate: 0.1, max_capacity: 300, terrain_pref: ['forest'] },
            { resource_type: 'stone', count: 6, extraction_rate: 3, regen_rate: 0.0, max_capacity: 400, terrain_pref: ['mountain', 'grassland'] },
        ];
        for (const cfg of configs) {
            const candidates = passable.filter(t => cfg.terrain_pref.length === 0 || cfg.terrain_pref.includes(t.terrain));
            const shuffled = [...candidates].sort(() => Math.random() - 0.5);
            const chosen = shuffled.slice(0, cfg.count);
            for (const tile of chosen) {
                nodes.push({
                    x: tile.x,
                    y: tile.y,
                    resource_type: cfg.resource_type,
                    current_amount: cfg.max_capacity,
                    max_capacity: cfg.max_capacity,
                    extraction_rate: cfg.extraction_rate,
                    regen_rate: cfg.regen_rate,
                });
            }
        }
        return nodes;
    }
}
exports.MapGenerator = MapGenerator;
