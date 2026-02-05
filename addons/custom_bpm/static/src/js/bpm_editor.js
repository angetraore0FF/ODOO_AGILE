/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onMounted, onWillUnmount, useRef } from "@odoo/owl";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { _t } from "@web/core/l10n/translation";
import { useService } from "@web/core/utils/hooks";

export class BpmEditorWidget extends Component {
    static template = "custom_bpm.BpmEditorWidget";
    static props = { ...standardFieldProps };

    setup() {
        this.canvasRef = useRef("canvas");
        this.orm = useService("orm");
        
        this.state = useState({
            cells: [],
            selectedCells: [],
            isDragging: false,
            dragStart: null,
            isConnecting: false,
            connectionSource: null,
            connectionSourcePoint: null,
            tempConnection: null,
            hoveredCell: null,
            hoveredConnectionPoint: null,
            zoom: 1,
            panOffset: { x: 0, y: 0 },
            isPanning: false,
            panStart: { x: 0, y: 0 },
            gridSize: 10,
            snapToGrid: true,
            showGrid: true,
            paletteCollapsed: false,
        });

        onMounted(async () => {
            try {
                await this.loadDefinition();
                // Centrer la grille au chargement
                const canvas = this.canvasRef.el;
                if (canvas && this.state.cells.length === 0) {
                    const rect = canvas.getBoundingClientRect();
                    this.state.panOffset.x = rect.width / 2;
                    this.state.panOffset.y = rect.height / 2;
                }
                this.initEvents();
            } catch (error) {
                console.error("Erreur lors de l'initialisation de l'éditeur BPM:", error);
                // Initialiser avec un état vide en cas d'erreur
                this.state.cells = [];
                this.initEvents();
            }
        });

        onWillUnmount(() => this.cleanup());
    }

    async loadDefinition() {
        try {
            // Vérifier que le record existe et a les données
            if (!this.props.record || !this.props.record.data) {
                this.state.cells = [];
                return;
            }
            
            const value = this.props.record.data[this.props.name];
            if (value && typeof value === 'string' && value.trim()) {
                try {
                    const data = JSON.parse(value);
                    // Valider que c'est bien un tableau de cellules
                    if (data && Array.isArray(data.cells)) {
                        // Filtrer et nettoyer les cellules invalides
                        this.state.cells = data.cells.filter(cell => {
                            if (!cell || !cell.id || typeof cell.id !== 'string') {
                                return false;
                            }
                            // Vérifier que l'ID est valide (ne contient pas de virgules ou caractères spéciaux problématiques)
                            if (cell.id.includes(',') || cell.id.length < 3) {
                                console.warn('ID de cellule invalide ignoré:', cell.id);
                                return false;
                            }
                            // Vérifier le type
                            if (cell.type !== 'vertex' && cell.type !== 'edge') {
                                return false;
                            }
                            // Pour les edges, vérifier que source et target sont valides
                            if (cell.type === 'edge') {
                                if (!cell.source || !cell.target || 
                                    typeof cell.source !== 'string' || 
                                    typeof cell.target !== 'string' ||
                                    cell.source.includes(',') || 
                                    cell.target.includes(',')) {
                                    console.warn('Connexion invalide ignorée:', cell);
                                    return false;
                                }
                            }
                            return true;
                        });
                        
                        // Régénérer les IDs invalides si nécessaire
                        let cleanedCells = this.state.cells.map((cell, index) => {
                            // Régénérer les IDs invalides
                            if (!cell.id || !cell.id.startsWith('bpm_') || cell.id.includes(',')) {
                                const timestamp = Date.now() + index; // Éviter les collisions
                                const random = Math.random().toString(36).substring(2, 9);
                                cell.id = cell.type === 'edge' 
                                    ? `bpm_edge_${timestamp}_${random}`
                                    : `bpm_cell_${timestamp}_${random}`;
                            }
                            return cell;
                        });
                        
                        // Créer un map des IDs valides pour référence rapide
                        const validIds = new Set(cleanedCells.map(c => c.id));
                        
                        // Nettoyer les connexions (edges) qui ont des source/target invalides
                        cleanedCells = cleanedCells.map(cell => {
                            if (cell.type === 'edge') {
                                // Nettoyer source
                                if (cell.source && (typeof cell.source !== 'string' || cell.source.includes(','))) {
                                    // Essayer de trouver une correspondance partielle
                                    const sourceMatch = cleanedCells.find(c => 
                                        c.id === cell.source || 
                                        (cell.source.includes(',') && c.id === cell.source.split(',')[0])
                                    );
                                    if (sourceMatch && validIds.has(sourceMatch.id)) {
                                        cell.source = sourceMatch.id;
                                    } else {
                                        return null; // Supprimer cette connexion invalide
                                    }
                                }
                                // Nettoyer target
                                if (cell.target && (typeof cell.target !== 'string' || cell.target.includes(','))) {
                                    const targetMatch = cleanedCells.find(c => 
                                        c.id === cell.target || 
                                        (cell.target.includes(',') && c.id === cell.target.split(',')[0])
                                    );
                                    if (targetMatch && validIds.has(targetMatch.id)) {
                                        cell.target = targetMatch.id;
                                    } else {
                                        return null; // Supprimer cette connexion invalide
                                    }
                                }
                            }
                            return cell;
                        }).filter(cell => cell !== null);
                        
                        // Mettre à jour validIds après nettoyage
                        validIds.clear();
                        cleanedCells.forEach(c => validIds.add(c.id));
                        
                        // Nettoyer les connexions qui référencent des cellules inexistantes
                        cleanedCells = cleanedCells.filter(cell => {
                            if (cell.type === 'edge') {
                                const sourceExists = validIds.has(cell.source);
                                const targetExists = validIds.has(cell.target);
                                if (!sourceExists || !targetExists) {
                                    console.warn('Connexion orpheline supprimée:', cell);
                                    return false;
                                }
                            }
                            return true;
                        });
                        
                        this.state.cells = cleanedCells;
                        
                        // Si des données ont été nettoyées, sauvegarder automatiquement
                        if (cleanedCells.length !== data.cells.length) {
                            console.warn('Données BPM nettoyées, sauvegarde automatique...');
                            // Sauvegarder de manière asynchrone pour ne pas bloquer
                            setTimeout(() => this.saveDefinition(), 100);
                        }
                    } else {
                        this.state.cells = [];
                    }
                } catch (parseError) {
                    console.error("Erreur parsing JSON BPM:", parseError);
                    this.state.cells = [];
                }
            } else {
                // Si le JSON est vide, charger depuis les nœuds Python
                await this.loadFromPythonNodes();
            }
        } catch (error) {
            console.error("Erreur chargement BPM:", error);
            this.state.cells = [];
        }
    }

    async loadFromPythonNodes() {
        try {
            if (!this.props.record || !this.props.record.resId) {
                return;
            }
            
            const processId = this.props.record.resId;
            
            // Charger les nœuds depuis Python
            const nodes = await this.orm.call(
                'bpm.node',
                'search_read',
                [[['process_id', '=', processId]]],
                { fields: ['id', 'name', 'node_type', 'position_x', 'position_y', 'node_id'] }
            );
            
            // Charger les edges depuis Python
            const edges = await this.orm.call(
                'bpm.edge',
                'search_read',
                [[['process_id', '=', processId]]],
                { fields: ['id', 'name', 'source_node_id', 'target_node_id', 'edge_id'] }
            );
            
            // Créer un map des nœuds Python par node_id
            const nodeMap = {};
            nodes.forEach(node => {
                const cellId = `bpm_node_${node.node_id}`;
                nodeMap[node.id] = cellId;
                
                // Mapper le type de nœud vers la forme
                let shape = 'task';
                if (node.node_type === 'start') shape = 'start';
                else if (node.node_type === 'end') shape = 'end';
                else if (node.node_type === 'gateway') shape = 'gateway';
                
                // Définir les dimensions selon le type
                let width = 120, height = 80;
                if (shape === 'start' || shape === 'end') {
                    width = 50;
                    height = 50;
                } else if (shape === 'gateway') {
                    width = 60;
                    height = 60;
                }
                
                const cell = {
                    id: cellId,
                    type: 'vertex',
                    shape: shape,
                    x: node.position_x || 0,
                    y: node.position_y || 0,
                    width: width,
                    height: height,
                    label: node.name || '',
                    pythonId: node.id,
                    pythonNodeId: node.node_id,
                };
                
                this.state.cells.push(cell);
            });
            
            // Créer les edges
            edges.forEach(edge => {
                const sourcePythonId = edge.source_node_id && edge.source_node_id[0];
                const targetPythonId = edge.target_node_id && edge.target_node_id[0];
                
                if (sourcePythonId && targetPythonId && nodeMap[sourcePythonId] && nodeMap[targetPythonId]) {
                    const cell = {
                        id: `bpm_edge_${edge.edge_id}`,
                        type: 'edge',
                        source: nodeMap[sourcePythonId],
                        target: nodeMap[targetPythonId],
                        label: edge.name || '',
                        pythonId: edge.id,
                        pythonEdgeId: edge.edge_id,
                    };
                    this.state.cells.push(cell);
                }
            });
            
            // Sauvegarder le JSON généré
            if (this.state.cells.length > 0) {
                await this.saveDefinition();
            }
        } catch (error) {
            console.error("Erreur chargement depuis nœuds Python:", error);
        }
    }

    async saveDefinition() {
        try {
            // Nettoyer et valider les cellules avant sauvegarde
            const cleanedCells = this.state.cells.map(cell => {
                // S'assurer que l'ID est valide
                if (!cell.id || typeof cell.id !== 'string' || cell.id.includes(',')) {
                    const timestamp = Date.now();
                    const random = Math.random().toString(36).substring(2, 9);
                    cell.id = cell.type === 'edge' 
                        ? `bpm_edge_${timestamp}_${random}`
                        : `bpm_cell_${timestamp}_${random}`;
                }
                
                // Pour les edges, nettoyer source et target
                if (cell.type === 'edge') {
                    if (cell.source && typeof cell.source === 'string' && cell.source.includes(',')) {
                        // Trouver la cellule source par position ou régénérer
                        const sourceCell = this.state.cells.find(c => 
                            c.id === cell.source || c.id === cell.source.split(',')[0]
                        );
                        if (sourceCell) {
                            cell.source = sourceCell.id;
                        }
                    }
                    if (cell.target && typeof cell.target === 'string' && cell.target.includes(',')) {
                        const targetCell = this.state.cells.find(c => 
                            c.id === cell.target || c.id === cell.target.split(',')[0]
                        );
                        if (targetCell) {
                            cell.target = targetCell.id;
                        }
                    }
                }
                
                return cell;
            }).filter(cell => {
                // Filtrer les cellules invalides
                if (!cell || !cell.id || cell.id.includes(',')) {
                    return false;
                }
                if (cell.type === 'edge' && (!cell.source || !cell.target || 
                    cell.source.includes(',') || cell.target.includes(','))) {
                    return false;
                }
                return true;
            });
            
            const data = {
                cells: cleanedCells,
                version: "1.0"
            };
            const jsonValue = JSON.stringify(data);
            
            // Utiliser la méthode update du record de manière sécurisée
            if (this.props.record && this.props.record.update) {
                await this.props.record.update({ [this.props.name]: jsonValue });
                // Mettre à jour l'état avec les cellules nettoyées
                this.state.cells = cleanedCells;
                
                // Synchroniser avec les nœuds Python
                await this.syncToPython();
            }
        } catch (error) {
            console.error("Erreur sauvegarde BPM:", error);
            // Ne pas bloquer l'interface en cas d'erreur
        }
    }

    async syncVertexToPython(cell) {
        try {
            if (!this.props.record || !this.props.record.resId) {
                console.warn('⚠️ Impossible de synchroniser: record ou resId manquant');
                return;
            }
            
            const processId = this.props.record.resId;
            
            // Mapper la forme vers le type de nœud
            let nodeType = 'task';
            if (cell.shape === 'start') nodeType = 'start';
            else if (cell.shape === 'end') nodeType = 'end';
            else if (cell.shape === 'gateway') nodeType = 'gateway';
            
            if (cell.pythonId) {
                // Mettre à jour le nœud existant
                console.log('🔄 Mise à jour nœud Python existant:', cell.pythonId);
                await this.orm.write('bpm.node', [cell.pythonId], {
                    name: cell.label || cell.shape || 'Nouveau nœud',
                    position_x: cell.x,
                    position_y: cell.y,
                });
            } else {
                // Créer un nouveau nœud
                // Extraire l'ID unique depuis l'ID de la cellule
                let nodeId = cell.id;
                if (nodeId.startsWith('bpm_node_')) {
                    nodeId = nodeId.replace('bpm_node_', '');
                } else if (nodeId.startsWith('bpm_cell_')) {
                    nodeId = nodeId.replace('bpm_cell_', '');
                } else {
                    // Générer un ID unique si nécessaire
                    nodeId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                }
                
                console.log('🆕 Création nouveau nœud Python:', {
                    process_id: processId,
                    name: cell.label || cell.shape || 'Nouveau nœud',
                    node_type: nodeType,
                    position_x: cell.x,
                    position_y: cell.y,
                    node_id: nodeId,
                });
                
                const result = await this.orm.create('bpm.node', [{
                    process_id: processId,
                    name: cell.label || cell.shape || 'Nouveau nœud',
                    node_type: nodeType,
                    position_x: cell.x,
                    position_y: cell.y,
                    node_id: nodeId,
                }]);
                
                // Stocker l'ID Python dans la cellule
                if (result && result.length > 0) {
                    cell.pythonId = result[0];
                    cell.pythonNodeId = nodeId;
                    console.log('✅ Nœud Python créé avec succès. ID Python:', result[0], 'node_id:', nodeId);
                } else {
                    console.error('❌ Erreur: aucun ID retourné lors de la création du nœud');
                }
            }
        } catch (error) {
            console.error("❌ Erreur synchronisation vertex vers Python:", error);
            throw error; // Propager l'erreur pour le débogage
        }
    }

    async syncEdgeToPython(cell) {
        try {
            if (!this.props.record || !this.props.record.resId) {
                console.warn('⚠️ Impossible de synchroniser edge: record ou resId manquant');
                return;
            }
            
            const processId = this.props.record.resId;
            const sourceCell = this.getCellById(cell.source);
            const targetCell = this.getCellById(cell.target);
            
            if (!sourceCell || !targetCell) {
                console.warn('⚠️ Impossible de synchroniser edge: source ou target cellule introuvable');
                return;
            }
            
            if (!sourceCell.pythonId || !targetCell.pythonId) {
                console.warn('⚠️ Impossible de synchroniser edge: source ou target n\'a pas d\'ID Python. Source:', sourceCell.pythonId, 'Target:', targetCell.pythonId);
                // Essayer de créer les nœuds manquants
                if (!sourceCell.pythonId && sourceCell.type === 'vertex') {
                    await this.syncVertexToPython(sourceCell);
                }
                if (!targetCell.pythonId && targetCell.type === 'vertex') {
                    await this.syncVertexToPython(targetCell);
                }
                
                // Vérifier à nouveau
                if (!sourceCell.pythonId || !targetCell.pythonId) {
                    console.error('❌ Impossible de créer l\'edge: les nœuds source/target n\'ont toujours pas d\'ID Python');
                    return;
                }
            }
            
            if (cell.pythonId) {
                // Mettre à jour l'edge existant
                console.log('🔄 Mise à jour edge Python existant:', cell.pythonId);
                await this.orm.write('bpm.edge', [cell.pythonId], {
                    name: cell.label || '',
                });
            } else {
                // Créer un nouvel edge
                let edgeId = cell.id;
                if (edgeId.startsWith('bpm_edge_')) {
                    edgeId = edgeId.replace('bpm_edge_', '');
                } else {
                    edgeId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                }
                
                console.log('🆕 Création nouveau edge Python:', {
                    process_id: processId,
                    source_node_id: sourceCell.pythonId,
                    target_node_id: targetCell.pythonId,
                    name: cell.label || '',
                    edge_id: edgeId,
                });
                
                const result = await this.orm.create('bpm.edge', [{
                    process_id: processId,
                    source_node_id: sourceCell.pythonId,
                    target_node_id: targetCell.pythonId,
                    name: cell.label || '',
                    edge_id: edgeId,
                }]);
                
                // Stocker l'ID Python dans la cellule
                if (result && result.length > 0) {
                    cell.pythonId = result[0];
                    cell.pythonEdgeId = edgeId;
                    console.log('✅ Edge Python créé avec succès. ID Python:', result[0], 'edge_id:', edgeId);
                } else {
                    console.error('❌ Erreur: aucun ID retourné lors de la création de l\'edge');
                }
            }
        } catch (error) {
            console.error("❌ Erreur synchronisation edge vers Python:", error);
            throw error; // Propager l'erreur pour le débogage
        }
    }

    async syncToPython() {
        try {
            if (!this.props.record || !this.props.record.resId) return;
            
            // Synchroniser tous les vertices
            for (const cell of this.state.cells) {
                if (cell.type === 'vertex') {
                    await this.syncVertexToPython(cell);
                } else if (cell.type === 'edge') {
                    await this.syncEdgeToPython(cell);
                }
            }
        } catch (error) {
            console.error("Erreur synchronisation globale vers Python:", error);
        }
    }

    async onLabelChange() {
        // Synchroniser le label modifié avec Python
        const selectedCell = this.state.selectedCells[0];
        if (selectedCell) {
            if (selectedCell.type === 'vertex' && selectedCell.pythonId) {
                await this.syncVertexToPython(selectedCell);
            } else if (selectedCell.type === 'edge' && selectedCell.pythonId) {
                await this.syncEdgeToPython(selectedCell);
            }
        }
        await this.saveDefinition();
    }

    initEvents() {
        const canvas = this.canvasRef.el;
        if (!canvas) return;

        const handlers = {
            mousedown: this.onMouseDown.bind(this),
            mousemove: this.onMouseMove.bind(this),
            mouseup: this.onMouseUp.bind(this),
            wheel: this.onWheel.bind(this),
            contextmenu: (e) => e.preventDefault(),
        };

        Object.entries(handlers).forEach(([ev, fn]) => {
            canvas.addEventListener(ev, fn, { passive: false });
        });

        window.addEventListener('keydown', this.onKeyDown.bind(this));

        this._eventCleanup = () => {
            Object.entries(handlers).forEach(([ev, fn]) => {
                canvas.removeEventListener(ev, fn);
            });
            window.removeEventListener('keydown', this.onKeyDown.bind(this));
        };
    }

    cleanup() {
        if (this._eventCleanup) this._eventCleanup();
    }

    getCanvasPoint(event) {
        const rect = this.canvasRef.el.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left - this.state.panOffset.x) / this.state.zoom,
            y: (event.clientY - rect.top - this.state.panOffset.y) / this.state.zoom,
        };
    }

    snapToGrid(value) {
        if (!this.state.snapToGrid) return value;
        return Math.round(value / this.state.gridSize) * this.state.gridSize;
    }

    getCellsByType(type) {
        return this.state.cells.filter(c => c.type === type);
    }

    getCellById(id) {
        return this.state.cells.find(c => c.id === id);
    }

    async addCell(cell) {
        // Ajouter la cellule à l'état
        this.state.cells.push(cell);
        this.state.selectedCells = [cell];
        
        console.log('📝 Ajout d\'une cellule:', cell.type, cell.shape || '', cell.id);
        
        // Si c'est un vertex, créer le nœud Python immédiatement
        if (cell.type === 'vertex' && this.props.record && this.props.record.resId) {
            try {
                await this.syncVertexToPython(cell);
                console.log('✅ Nœud Python créé/mis à jour:', cell.pythonId, cell.label);
            } catch (error) {
                console.error('❌ Erreur création nœud Python:', error);
            }
        }
        
        // Si c'est un edge, créer l'edge Python (mais seulement si les nœuds source/target existent)
        if (cell.type === 'edge' && this.props.record && this.props.record.resId) {
            try {
                // Attendre que les nœuds source et target soient créés en Python
                const sourceCell = this.getCellById(cell.source);
                const targetCell = this.getCellById(cell.target);
                
                if (sourceCell && targetCell) {
                    // Si les nœuds n'ont pas encore d'ID Python, les créer d'abord
                    if (!sourceCell.pythonId && sourceCell.type === 'vertex') {
                        await this.syncVertexToPython(sourceCell);
                    }
                    if (!targetCell.pythonId && targetCell.type === 'vertex') {
                        await this.syncVertexToPython(targetCell);
                    }
                    
                    // Maintenant créer l'edge
                    await this.syncEdgeToPython(cell);
                    console.log('✅ Edge Python créé/mis à jour:', cell.pythonId, cell.label);
                }
            } catch (error) {
                console.error('❌ Erreur création edge Python:', error);
            }
        }
        
        // Sauvegarder le JSON (qui contient maintenant toutes les cellules)
        await this.saveDefinition();
        console.log('💾 JSON sauvegardé avec', this.state.cells.length, 'cellules');
    }

    async deleteCell(cell) {
        const index = this.state.cells.findIndex(c => c.id === cell.id);
        if (index !== -1) {
            // Supprimer le nœud/edge Python si il existe
            if (cell.pythonId && this.props.record && this.props.record.resId) {
                if (cell.type === 'vertex') {
                    try {
                        await this.orm.unlink('bpm.node', [cell.pythonId]);
                    } catch (error) {
                        console.warn('Erreur suppression nœud Python:', error);
                    }
                } else if (cell.type === 'edge') {
                    try {
                        await this.orm.unlink('bpm.edge', [cell.pythonId]);
                    } catch (error) {
                        console.warn('Erreur suppression edge Python:', error);
                    }
                }
            }
            
            this.state.cells.splice(index, 1);
            this.state.cells = this.state.cells.filter(c => 
                !(c.type === 'edge' && (c.source === cell.id || c.target === cell.id))
            );
            this.state.selectedCells = this.state.selectedCells.filter(c => c.id !== cell.id);
            await this.saveDefinition();
        }
    }

    createShape(type, x, y) {
        // Générer un ID unique qui ne peut pas être confondu avec un nom de modèle
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 9);
        const id = `bpm_cell_${timestamp}_${random}`;
        const snappedX = this.snapToGrid(x);
        const snappedY = this.snapToGrid(y);
        
        const shapes = {
            start: {
                id,
                type: 'vertex',
                shape: 'start',
                x: snappedX,
                y: snappedY,
                width: 50,
                height: 50,
                label: 'Début',
                style: 'fillColor=#28a745;strokeColor=#1e7e34;fontColor=#ffffff;',
            },
            task: {
                id,
                type: 'vertex',
                shape: 'task',
                x: snappedX,
                y: snappedY,
                width: 120,
                height: 80,
                label: 'Tâche',
                style: 'fillColor=#007bff;strokeColor=#0056b3;fontColor=#ffffff;',
            },
            gateway: {
                id,
                type: 'vertex',
                shape: 'gateway',
                x: snappedX,
                y: snappedY,
                width: 60,
                height: 60,
                label: 'Décision',
                style: 'fillColor=#ffc107;strokeColor=#e0a800;fontColor=#000000;',
            },
            end: {
                id,
                type: 'vertex',
                shape: 'end',
                x: snappedX,
                y: snappedY,
                width: 50,
                height: 50,
                label: 'Fin',
                style: 'fillColor=#dc3545;strokeColor=#c82333;fontColor=#ffffff;',
            },
        };

        return shapes[type] || shapes.task;
    }

    findCellAt(x, y) {
        for (let i = this.state.cells.length - 1; i >= 0; i--) {
            const cell = this.state.cells[i];
            if (cell.type !== 'vertex') continue;
            
            if (x >= cell.x && x <= cell.x + cell.width &&
                y >= cell.y && y <= cell.y + cell.height) {
                return cell;
            }
        }
        return null;
    }

    findConnectionPointAt(x, y) {
        const threshold = 8;
        
        for (let i = this.state.cells.length - 1; i >= 0; i--) {
            const cell = this.state.cells[i];
            if (cell.type !== 'vertex') continue;
            
            const points = this.getConnectionPoints(cell);
            for (const [side, point] of Object.entries(points)) {
                const dx = x - point.x;
                const dy = y - point.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist <= threshold) {
                    return { cell, side, point };
                }
            }
        }
        return null;
    }

    getConnectionPoints(cell) {
        const w = cell.width;
        const h = cell.height;
        return {
            top: { x: cell.x + w / 2, y: cell.y },
            right: { x: cell.x + w, y: cell.y + h / 2 },
            bottom: { x: cell.x + w / 2, y: cell.y + h },
            left: { x: cell.x, y: cell.y + h / 2 },
        };
    }

    getConnectionPointsRelative(cell) {
        const w = cell.width;
        const h = cell.height;
        return {
            top: { x: w / 2, y: 0 },
            right: { x: w, y: h / 2 },
            bottom: { x: w / 2, y: h },
            left: { x: 0, y: h / 2 },
        };
    }

    onMouseDown(e) {
        e.preventDefault();
        const pt = this.getCanvasPoint(e);

        // Pan avec bouton du milieu ou Shift + clic gauche
        if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
            this.state.isPanning = true;
            this.state.panStart = { x: e.clientX - this.state.panOffset.x, y: e.clientY - this.state.panOffset.y };
            return;
        }

        const connPoint = this.findConnectionPointAt(pt.x, pt.y);
        if (connPoint && e.button === 0) {
            this.state.isConnecting = true;
            this.state.connectionSource = connPoint.cell;
            this.state.connectionSourcePoint = connPoint.point;
            this.state.tempConnection = { x: pt.x, y: pt.y };
            this.state.selectedCells = [connPoint.cell];
            return;
        }

        const cell = this.findCellAt(pt.x, pt.y);
        if (cell && e.button === 0) {
            this.state.isDragging = true;
            this.state.dragStart = pt;
            
            if (!e.ctrlKey && !e.metaKey) {
                if (!this.state.selectedCells.find(c => c.id === cell.id)) {
                    this.state.selectedCells = [cell];
                }
            } else {
                const index = this.state.selectedCells.findIndex(c => c.id === cell.id);
                if (index === -1) {
                    this.state.selectedCells.push(cell);
                } else {
                    this.state.selectedCells.splice(index, 1);
                }
            }
            return;
        }

        // Si on clique sur la grille vide (pas sur un nœud ni un point de connexion), activer le pan
        if (!cell && !connPoint && e.button === 0) {
            this.state.selectedCells = [];
            this.state.isPanning = true;
            this.state.panStart = { x: e.clientX - this.state.panOffset.x, y: e.clientY - this.state.panOffset.y };
            return;
        }
    }

    onMouseMove(e) {
        const pt = this.getCanvasPoint(e);

        if (this.state.isPanning) {
            this.state.panOffset.x = e.clientX - this.state.panStart.x;
            this.state.panOffset.y = e.clientY - this.state.panStart.y;
            return;
        }

        if (this.state.isConnecting) {
            this.state.tempConnection = { x: pt.x, y: pt.y };
            
            const connPoint = this.findConnectionPointAt(pt.x, pt.y);
            if (connPoint && connPoint.cell !== this.state.connectionSource) {
                this.state.hoveredConnectionPoint = connPoint;
            } else {
                this.state.hoveredConnectionPoint = null;
            }
            return;
        }

        if (this.state.isDragging && this.state.selectedCells.length > 0 && this.state.dragStart) {
            const firstCell = this.state.selectedCells[0];
            if (firstCell && firstCell.type === 'vertex') {
                const deltaX = pt.x - this.state.dragStart.x;
                const deltaY = pt.y - this.state.dragStart.y;
                
                this.state.selectedCells.forEach(cell => {
                    if (cell.type === 'vertex') {
                        const newX = this.snapToGrid(cell.x + deltaX);
                        const newY = this.snapToGrid(cell.y + deltaY);
                        cell.x = Math.max(0, newX);
                        cell.y = Math.max(0, newY);
                    }
                });
                
                this.state.dragStart = pt;
            }
        }

        const hovered = this.findCellAt(pt.x, pt.y);
        this.state.hoveredCell = hovered;
        
        // Changer le curseur selon le contexte
        const canvas = this.canvasRef.el;
        if (canvas) {
            if (this.state.isPanning) {
                canvas.style.cursor = 'grabbing';
            } else if (this.state.isConnecting) {
                canvas.style.cursor = 'crosshair';
            } else if (hovered) {
                canvas.style.cursor = 'move';
            } else {
                canvas.style.cursor = 'grab';
            }
        }
    }

    async onMouseUp(e) {
        if (this.state.isConnecting) {
            const pt = this.getCanvasPoint(e);
            const connPoint = this.findConnectionPointAt(pt.x, pt.y);
            
            if (connPoint && connPoint.cell !== this.state.connectionSource) {
                // Vérifier que les IDs source et target sont valides
                const sourceId = this.state.connectionSource?.id;
                const targetId = connPoint.cell?.id;
                
                if (!sourceId || !targetId || 
                    typeof sourceId !== 'string' || 
                    typeof targetId !== 'string' ||
                    sourceId.includes(',') || 
                    targetId.includes(',')) {
                    console.error('IDs invalides pour la connexion:', { sourceId, targetId });
                    return;
                }
                
                // Générer un ID unique pour la connexion
                const timestamp = Date.now();
                const random = Math.random().toString(36).substring(2, 9);
                const edgeId = `bpm_edge_${timestamp}_${random}`;
                const edge = {
                    id: edgeId,
                    type: 'edge',
                    source: sourceId,
                    target: targetId,
                    sourcePoint: this.state.connectionSourcePoint,
                    targetPoint: connPoint.point,
                    label: '',
                    style: 'strokeColor=#333333;strokeWidth=2;endArrow=classic;',
                };
                this.addCell(edge);
                this.state.selectedCells = [edge];
            }
            
            this.state.isConnecting = false;
            this.state.connectionSource = null;
            this.state.connectionSourcePoint = null;
            this.state.tempConnection = null;
            this.state.hoveredConnectionPoint = null;
        }
        
        if (this.state.isDragging) {
            this.state.isDragging = false;
            this.state.dragStart = null;
            // Synchroniser les positions des nœuds déplacés
            for (const cell of this.state.selectedCells) {
                if (cell.type === 'vertex' && cell.pythonId) {
                    await this.syncVertexToPython(cell);
                }
            }
            await this.saveDefinition();
        }

        if (this.state.isPanning) {
            this.state.isPanning = false;
            const canvas = this.canvasRef.el;
            if (canvas) {
                canvas.style.cursor = 'grab';
            }
        }
    }

    onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.25, Math.min(4, this.state.zoom * delta));

        const rect = this.canvasRef.el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        this.state.panOffset.x = mx - (mx - this.state.panOffset.x) * (newZoom / this.state.zoom);
        this.state.panOffset.y = my - (my - this.state.panOffset.y) * (newZoom / this.state.zoom);

        this.state.zoom = newZoom;
    }

    async onKeyDown(e) {
        if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.matches('input, textarea')) {
            for (const cell of this.state.selectedCells) {
                await this.deleteCell(cell);
            }
            this.state.selectedCells = [];
        }
    }

    async onPaletteItemClick(type) {
        const centerX = (-this.state.panOffset.x / this.state.zoom) + 400;
        const centerY = (-this.state.panOffset.y / this.state.zoom) + 300;
        const shape = this.createShape(type, centerX, centerY);
        await this.addCell(shape);
    }

    getEdgePath(edge) {
        const source = this.getCellById(edge.source);
        const target = this.getCellById(edge.target);
        if (!source || !target) return "";

        const sourcePoint = edge.sourcePoint || this.getConnectionPoints(source).right;
        const targetPoint = edge.targetPoint || this.getConnectionPoints(target).left;

        return this.getOrthogonalPath(
            sourcePoint.x, sourcePoint.y,
            targetPoint.x, targetPoint.y
        );
    }

    getOrthogonalPath(sx, sy, tx, ty) {
        const dx = tx - sx;
        const dy = ty - sy;
        const midX = (sx + tx) / 2;
        const midY = (sy + ty) / 2;

        if (Math.abs(dx) > Math.abs(dy)) {
            return `M${sx},${sy} L${midX},${sy} L${midX},${ty} L${tx},${ty}`;
        } else {
            return `M${sx},${sy} L${sx},${midY} L${tx},${midY} L${tx},${ty}`;
        }
    }

    isSelected(cell) {
        return this.state.selectedCells.some(c => c.id === cell.id);
    }

    isHovered(cell) {
        return this.state.hoveredCell && this.state.hoveredCell.id === cell.id;
    }

    onEdgeClick(cell) {
        if (!this.state.isConnecting) {
            this.state.selectedCells = [cell];
        }
    }

    onDeleteSelected() {
        this.state.selectedCells.forEach(c => this.deleteCell(c));
        this.state.selectedCells = [];
    }

    togglePalette() {
        this.state.paletteCollapsed = !this.state.paletteCollapsed;
    }
}

registry.category("fields").add("bpm_editor", {
    component: BpmEditorWidget,
    supportedTypes: ["text"],
});
