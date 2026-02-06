/** @odoo-module **/
import { registry } from "@web/core/registry";
import { Component, useState, onMounted, onWillUnmount, useRef } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { standardFieldProps } from "@web/views/fields/standard_field_props";

class BpmGraphEditor extends Component {
    static template = "custom_bpm.BpmGraphEditor";
    static props = { ...standardFieldProps };
    
    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.action = useService("action");
        this.canvasRef = useRef("canvas");
        this.containerRef = useRef("container");
        
        this.state = useState({
            nodes: [],
            edges: [],
            pendingNodes: [], // Nœuds en attente de sauvegarde
            pendingEdges: [], // Transitions en attente de sauvegarde
            connectingFrom: null,
            connectingFromPoint: null,
            selectedNodeId: null,
            selectedEdgeId: null,
            hoveredNodeId: null,
            hoveredConnectionPoint: null,
            zoom: 1,
            panX: 0,
            panY: 0,
            isPanning: false,
            isDragging: false,
            tempConnectionEnd: null,
            tempConnectionTarget: null,
            showInstructions: true,
            gridSize: 20,
            snapToGrid: true,
        });
        
        // Observer les changements du record pour détecter la sauvegarde
        this._watchRecord();
        
        this._dragState = null;
        this._panStart = null;
        
        onMounted(() => {
            this._load();
            this._setupKeyboardShortcuts();
            this._setupWheelZoom();
        });
        
        onWillUnmount(() => {
            this._cleanup();
        });
    }
    
    get processId() {
        const id = this.props.record?.resId || this.props.record?.id;
        if (!id) return null;
        if (typeof id === 'string') {
            if (id.startsWith('new_') || id.startsWith('datapoint_')) {
                return null;
            }
            const numId = parseInt(id, 10);
            return isNaN(numId) ? null : numId;
        }
        return typeof id === 'number' && !isNaN(id) ? id : null;
    }
    
    _watchRecord() {
        // Observer les changements du record pour détecter quand il est sauvegardé
        if (this.props.record) {
            const wasNew = !this.processId;
            // Vérifier périodiquement si le record a été sauvegardé
            this._checkInterval = setInterval(() => {
                const nowHasId = !!this.processId;
                if (wasNew && nowHasId && (this.state.pendingNodes.length > 0 || this.state.pendingEdges.length > 0)) {
                    // Le processus vient d'être sauvegardé, créer les nœuds en attente
                    this._savePendingItems();
                }
            }, 500);
        }
    }
    
    async _savePendingItems() {
        const pid = this.processId;
        if (!pid || isNaN(pid)) return;
        
        // Sauvegarder les nœuds en attente
        if (this.state.pendingNodes.length > 0) {
            try {
                // Créer une map des IDs temporaires vers les IDs réels
                const tempToRealIdMap = {};
                
                const nodesToCreate = this.state.pendingNodes.map(node => {
                    const nodeData = { ...node };
                    delete nodeData.id; // Supprimer l'ID temporaire
                    return {
                        ...nodeData,
                        process_id: pid
                    };
                });
                
                const createdNodeIds = await this.orm.create("bpm.node", nodesToCreate);
                
                // Créer la map des IDs (createdNodeIds est un tableau d'IDs)
                if (Array.isArray(createdNodeIds) && createdNodeIds.length === this.state.pendingNodes.length) {
                    this.state.pendingNodes.forEach((node, index) => {
                        tempToRealIdMap[node.id] = createdNodeIds[index];
                    });
                }
                
                // Mettre à jour les transitions en attente avec les vrais IDs
                this.state.pendingEdges.forEach(edge => {
                    if (tempToRealIdMap[edge.source_node_id]) {
                        edge.source_node_id = tempToRealIdMap[edge.source_node_id];
                    }
                    if (tempToRealIdMap[edge.target_node_id]) {
                        edge.target_node_id = tempToRealIdMap[edge.target_node_id];
                    }
                });
                
                this.state.pendingNodes = [];
                await this._load();
                // Rafraîchir la vue Odoo pour mettre à jour la liste des nœuds
                await this._refreshView();
                this.notification.add("Nœuds sauvegardés", { type: "success" });
            } catch (error) {
                console.error("Erreur lors de la sauvegarde des nœuds:", error);
                this.notification.add("Erreur lors de la sauvegarde des nœuds", { type: "danger" });
            }
        }
        
        // Sauvegarder les transitions en attente
        if (this.state.pendingEdges.length > 0) {
            try {
                const edgesToCreate = this.state.pendingEdges.map(edge => {
                    const edgeData = { ...edge };
                    delete edgeData.id; // Supprimer l'ID temporaire
                    return {
                        ...edgeData,
                        process_id: pid
                    };
                });
                await this.orm.create("bpm.edge", edgesToCreate);
                this.state.pendingEdges = [];
                await this._load();
                // Rafraîchir la vue Odoo pour mettre à jour la liste des transitions
                await this._refreshView();
                this.notification.add("Transitions sauvegardées", { type: "success" });
            } catch (error) {
                console.error("Erreur lors de la sauvegarde des transitions:", error);
                this.notification.add("Erreur lors de la sauvegarde des transitions", { type: "danger" });
            }
        }
    }
    
    _generateTempId() {
        return 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    _getAllNodes() {
        // Retourne tous les nœuds (sauvegardés + en attente)
        return [...this.state.nodes, ...this.state.pendingNodes];
    }
    
    _getAllEdges() {
        // Retourne toutes les transitions (sauvegardées + en attente)
        return [...this.state.edges, ...this.state.pendingEdges];
    }
    
    async _load() {
        if (!this.processId) return;
        try {
            const nodes = await this.orm.searchRead(
                "bpm.node",
                [["process_id", "=", this.processId]],
                ["id", "name", "node_type", "position_x", "position_y", "node_id"]
            );
            const edges = await this.orm.searchRead(
                "bpm.edge",
                [["process_id", "=", this.processId]],
                ["id", "name", "source_node_id", "target_node_id"]
            );
            this.state.nodes = nodes;
            this.state.edges = edges;
        } catch (error) {
            console.error("Erreur lors du chargement:", error);
        }
    }
    
    async _refreshView() {
        // Rafraîchir le record pour mettre à jour les vues One2many
        if (this.props.record && this.props.record.resId) {
            try {
                // Attendre un peu pour laisser Odoo traiter la création
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Recharger le record pour mettre à jour les relations One2many
                await this.props.record.load();
                
                // Notifier le changement pour forcer le re-render des vues
                if (this.props.record.notify) {
                    this.props.record.notify();
                }
            } catch (error) {
                console.error("Erreur lors du rafraîchissement de la vue:", error);
            }
        }
    }
    
    _setupKeyboardShortcuts() {
        this._keyHandler = (ev) => {
            // Supprimer avec Delete ou Backspace
            if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.state.selectedNodeId) {
                ev.preventDefault();
                this.deleteSelected();
            }
            // Échapper pour annuler la connexion
            if (ev.key === 'Escape') {
                this.cancelConnection();
            }
            // Raccourcis pour ajouter des nœuds
            if (ev.ctrlKey || ev.metaKey) {
                if (ev.key === 's') {
                    ev.preventDefault();
                    // Sauvegarder (déjà fait automatiquement)
                }
            }
        };
        document.addEventListener('keydown', this._keyHandler);
    }
    
    _setupWheelZoom() {
        const container = this.containerRef.el;
        if (!container) return;
        
        this._wheelHandler = (ev) => {
            if (!ev.ctrlKey && !ev.metaKey) return;
            ev.preventDefault();
            
            const delta = ev.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = Math.max(0.1, Math.min(3, this.state.zoom * delta));
            
            // Zoom centré sur la position de la souris
            const rect = container.getBoundingClientRect();
            const x = ev.clientX - rect.left;
            const y = ev.clientY - rect.top;
            
            const zoomFactor = newZoom / this.state.zoom;
            this.state.panX = x - (x - this.state.panX) * zoomFactor;
            this.state.panY = y - (y - this.state.panY) * zoomFactor;
            this.state.zoom = newZoom;
        };
        
        container.addEventListener('wheel', this._wheelHandler, { passive: false });
    }
    
    _cleanup() {
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
        }
        if (this._wheelHandler && this.containerRef.el) {
            this.containerRef.el.removeEventListener('wheel', this._wheelHandler);
        }
        if (this._connectionMouseMoveHandler && this.containerRef.el) {
            this.containerRef.el.removeEventListener('mousemove', this._connectionMouseMoveHandler);
        }
        if (this._checkInterval) {
            clearInterval(this._checkInterval);
        }
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mouseup', this._onMouseUp);
    }
    
    _snapToGrid(value) {
        if (!this.state.snapToGrid) return value;
        return Math.round(value / this.state.gridSize) * this.state.gridSize;
    }
    
    _dims(node) {
        if (node.node_type === "start" || node.node_type === "end") return { w: 50, h: 50 };
        if (node.node_type === "gateway") return { w: 60, h: 60 };
        return { w: 120, h: 80 };
    }
    
    _center(node) {
        const d = this._dims(node);
        return { 
            cx: (node.position_x || 0) + d.w / 2, 
            cy: (node.position_y || 0) + d.h / 2 
        };
    }
    
    _getSVGPoint(ev) {
        const svg = this.canvasRef.el;
        if (!svg) return { x: 0, y: 0 };
        const pt = svg.createSVGPoint();
        pt.x = ev.clientX;
        pt.y = ev.clientY;
        const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
        // Appliquer la transformation inverse (zoom et pan)
        return {
            x: (svgPt.x - this.state.panX) / this.state.zoom,
            y: (svgPt.y - this.state.panY) / this.state.zoom
        };
    }
    
    _getCanvasCenter() {
        const container = this.containerRef.el;
        if (!container) return { x: 300, y: 200 };
        return {
            x: container.clientWidth / 2,
            y: container.clientHeight / 2
        };
    }
    
    async addNode(type) {
        const pid = this.processId;
        
        // Positionner le nouveau nœud au centre de la vue
        const center = this._getCanvasCenter();
        const centerX = (center.x - this.state.panX) / this.state.zoom;
        const centerY = (center.y - this.state.panY) / this.state.zoom;
        
        const nodeData = {
            id: this._generateTempId(),
            name: type === "start" ? "Début" : type === "end" ? "Fin" : type === "gateway" ? "Décision" : "Tâche",
            node_type: type,
            position_x: this._snapToGrid(centerX - 60),
            position_y: this._snapToGrid(centerY - 40),
        };
        
        // Si le processus est déjà sauvegardé, créer le nœud directement
        if (pid && !isNaN(pid)) {
            try {
                const vals = {
                    process_id: pid,
                    ...nodeData
                };
                delete vals.id; // L'ID sera généré par Odoo
                await this.orm.create("bpm.node", [vals]);
                await this._load();
                // Rafraîchir la vue Odoo pour mettre à jour la liste des nœuds
                await this._refreshView();
                this.notification.add("Nœud ajouté", { type: "success" });
            } catch (error) {
                this.notification.add("Erreur lors de l'ajout du nœud", { type: "danger" });
                console.error(error);
            }
        } else {
            // Sinon, ajouter le nœud en attente
            this.state.pendingNodes.push(nodeData);
            this.notification.add("Nœud ajouté (sera sauvegardé lors de l'enregistrement du processus)", { type: "info" });
        }
    }
    
    selectNode(node, ev) {
        // Si on est déjà en train de connecter, terminer la connexion
        if (this.state.connectingFrom) {
            this.finishConnect(node);
            return;
        }
        
        // Sinon, sélectionner le nœud et démarrer une connexion si on maintient Shift
        this.state.selectedNodeId = node.id;
        this.state.selectedEdgeId = null;
        
        // Démarrer une connexion si Shift est maintenu ou si on clique sur un point de connexion
        if (ev && (ev.shiftKey || ev.button === 2)) {
            this.startConnect(node);
        }
    }
    
    onConnectionPointClick(node, pointId, ev) {
        ev.stopPropagation();
        ev.preventDefault();
        
        // Si on est en train de connecter, terminer la connexion
        if (this.state.connectingFrom) {
            this.finishConnect(node);
            return;
        }
        
        // Sinon, démarrer une connexion depuis ce point
        const points = this._getConnectionPoints(node);
        const point = points.find(p => p.id === pointId);
        if (point) {
            this.startConnect(node, { cx: point.x, cy: point.y });
        }
    }
    
    selectEdge(edge) {
        this.state.selectedEdgeId = edge.id;
        this.state.selectedNodeId = null;
    }
    
    async deleteSelected() {
        if (this.state.selectedNodeId) {
            // Vérifier si c'est un nœud en attente (commence par 'temp_')
            if (typeof this.state.selectedNodeId === 'string' && this.state.selectedNodeId.startsWith('temp_')) {
                // Supprimer de la liste des nœuds en attente
                this.state.pendingNodes = this.state.pendingNodes.filter(n => n.id !== this.state.selectedNodeId);
                // Supprimer aussi les transitions en attente liées
                this.state.pendingEdges = this.state.pendingEdges.filter(
                    e => e.source_node_id !== this.state.selectedNodeId && e.target_node_id !== this.state.selectedNodeId
                );
                this.state.selectedNodeId = null;
                this.notification.add("Nœud supprimé", { type: "success" });
            } else {
                // Nœud sauvegardé, supprimer de la base
                try {
                await this.orm.unlink("bpm.node", [this.state.selectedNodeId]);
                this.state.selectedNodeId = null;
                await this._load();
                // Rafraîchir la vue Odoo pour mettre à jour la liste des nœuds
                await this._refreshView();
                this.notification.add("Nœud supprimé", { type: "success" });
                } catch (error) {
                    this.notification.add("Erreur lors de la suppression", { type: "danger" });
                }
            }
        } else if (this.state.selectedEdgeId) {
            // Vérifier si c'est une transition en attente
            if (typeof this.state.selectedEdgeId === 'string' && this.state.selectedEdgeId.startsWith('temp_')) {
                this.state.pendingEdges = this.state.pendingEdges.filter(e => e.id !== this.state.selectedEdgeId);
                this.state.selectedEdgeId = null;
                this.notification.add("Transition supprimée", { type: "success" });
            } else {
                try {
                await this.orm.unlink("bpm.edge", [this.state.selectedEdgeId]);
                this.state.selectedEdgeId = null;
                await this._load();
                // Rafraîchir la vue Odoo pour mettre à jour la liste des transitions
                await this._refreshView();
                this.notification.add("Transition supprimée", { type: "success" });
                } catch (error) {
                    this.notification.add("Erreur lors de la suppression", { type: "danger" });
                }
            }
        }
    }
    
    startConnect(node, point) {
        this.state.connectingFrom = node.id;
        this.state.connectingFromPoint = point || this._center(node);
        this.state.tempConnectionEnd = null;
        this.state.tempConnectionTarget = null;
        
        // Ajouter un listener pour suivre la souris
        if (!this._connectionMouseMoveHandler) {
            this._connectionMouseMoveHandler = (ev) => {
                if (this.state.connectingFrom) {
                    const pt = this._getSVGPoint(ev);
                    // Chercher le point de connexion le plus proche
                    const snapPoint = this._findNearestConnectionPoint(pt);
                    if (snapPoint) {
                        this.state.tempConnectionEnd = snapPoint.point;
                        this.state.tempConnectionTarget = snapPoint.node;
                        this.state.hoveredConnectionPoint = snapPoint.pointId;
                    } else {
                        this.state.tempConnectionEnd = pt;
                        this.state.tempConnectionTarget = null;
                        this.state.hoveredConnectionPoint = null;
                    }
                }
            };
            this.containerRef.el?.addEventListener('mousemove', this._connectionMouseMoveHandler);
        }
    }
    
    _findNearestConnectionPoint(point, threshold = 30) {
        let nearest = null;
        let minDistance = threshold;
        
        const allNodes = this._getAllNodes();
        for (const node of allNodes) {
            if (node.id === this.state.connectingFrom) continue;
            
            const connectionPoints = this._getConnectionPoints(node);
            for (const cp of connectionPoints) {
                const distance = Math.sqrt(
                    Math.pow(point.x - cp.x, 2) + Math.pow(point.y - cp.y, 2)
                );
                if (distance < minDistance) {
                    minDistance = distance;
                    nearest = {
                        node: node,
                        point: { x: cp.x, y: cp.y },
                        pointId: cp.id
                    };
                }
            }
        }
        
        return nearest;
    }
    
    _getConnectionPoints(node) {
        const d = this._dims(node);
        const x = node.position_x || 0;
        const y = node.position_y || 0;
        const points = [];
        
        if (node.node_type === 'start' || node.node_type === 'end') {
            // Cercle : 4 points (haut, droite, bas, gauche)
            const r = 25;
            const cx = x + r;
            const cy = y + r;
            points.push({ id: 'top', x: cx, y: cy - r });
            points.push({ id: 'right', x: cx + r, y: cy });
            points.push({ id: 'bottom', x: cx, y: cy + r });
            points.push({ id: 'left', x: cx - r, y: cy });
        } else if (node.node_type === 'task') {
            // Rectangle : 4 points (haut, droite, bas, gauche)
            const w = d.w;
            const h = d.h;
            points.push({ id: 'top', x: x + w/2, y: y });
            points.push({ id: 'right', x: x + w, y: y + h/2 });
            points.push({ id: 'bottom', x: x + w/2, y: y + h });
            points.push({ id: 'left', x: x, y: y + h/2 });
        } else if (node.node_type === 'gateway') {
            // Losange : 4 points (haut, droite, bas, gauche)
            const w = d.w;
            const h = d.h;
            points.push({ id: 'top', x: x + w/2, y: y });
            points.push({ id: 'right', x: x + w, y: y + h/2 });
            points.push({ id: 'bottom', x: x + w/2, y: y + h });
            points.push({ id: 'left', x: x, y: y + h/2 });
        }
        
        return points;
    }
    
    cancelConnection() {
        this.state.connectingFrom = null;
        this.state.connectingFromPoint = null;
        this.state.tempConnectionEnd = null;
        this.state.tempConnectionTarget = null;
        this.state.hoveredConnectionPoint = null;
        
        // Retirer le listener
        if (this._connectionMouseMoveHandler && this.containerRef.el) {
            this.containerRef.el.removeEventListener('mousemove', this._connectionMouseMoveHandler);
            this._connectionMouseMoveHandler = null;
        }
    }
    
    async finishConnect(targetNode) {
        if (!this.state.connectingFrom) return;
        
        const sourceId = this.state.connectingFrom;
        if (sourceId === targetNode.id) {
            this.cancelConnection();
            return;
        }
        
        // Utiliser le nœud cible (peut être différent si on a snapé sur un point)
        const finalTarget = this.state.tempConnectionTarget || targetNode;
        
        // Vérifier si la connexion existe déjà (sauvegardée ou en attente)
        const allEdges = this._getAllEdges();
        const existingEdge = allEdges.find(e => {
            const srcId = Array.isArray(e.source_node_id) ? e.source_node_id[0] : e.source_node_id;
            const tgtId = Array.isArray(e.target_node_id) ? e.target_node_id[0] : e.target_node_id;
            return srcId === sourceId && tgtId === finalTarget.id;
        });
        
        if (existingEdge) {
            this.notification.add("Cette connexion existe déjà", { type: "warning" });
            this.cancelConnection();
            return;
        }
        
        const pid = this.processId;
        
        // Si le processus est sauvegardé, créer la transition directement
        if (pid && !isNaN(pid)) {
            try {
                await this.orm.create("bpm.edge", [{
                    name: "Transition",
                    process_id: pid,
                    source_node_id: sourceId,
                    target_node_id: finalTarget.id,
                }]);
                this.cancelConnection();
                await this._load();
                // Rafraîchir la vue Odoo pour mettre à jour la liste des transitions
                await this._refreshView();
                this.notification.add("Transition créée", { type: "success" });
            } catch (error) {
                this.notification.add("Erreur lors de la création de la transition", { type: "danger" });
                console.error(error);
            }
        } else {
            // Sinon, ajouter la transition en attente
            this.state.pendingEdges.push({
                id: this._generateTempId(),
                name: "Transition",
                source_node_id: sourceId,
                target_node_id: finalTarget.id,
            });
            this.cancelConnection();
            this.notification.add("Transition créée (sera sauvegardée lors de l'enregistrement)", { type: "info" });
            // Note: La vue sera rafraîchie automatiquement lors de la sauvegarde du processus
        }
    }
    
    onCanvasMouseDown(ev) {
        if (ev.button !== 0) return; // Seulement clic gauche
        
        // Si on clique sur le canvas (pas sur un nœud), annuler la connexion ou démarrer le pan
        if (ev.target === this.canvasRef.el || ev.target.tagName === 'svg' || ev.target.classList.contains('o_bpm_canvas_container')) {
            if (this.state.connectingFrom) {
                // Annuler la connexion si on clique sur le canvas vide
                this.cancelConnection();
            } else {
                // Sinon, démarrer le pan
                this.state.isPanning = true;
                this._panStart = { x: ev.clientX, y: ev.clientY, panX: this.state.panX, panY: this.state.panY };
            }
            ev.preventDefault();
        }
    }
    
    onCanvasMouseMove(ev) {
        // Pan du canvas
        if (this.state.isPanning && this._panStart) {
            const dx = ev.clientX - this._panStart.x;
            const dy = ev.clientY - this._panStart.y;
            this.state.panX = this._panStart.panX + dx;
            this.state.panY = this._panStart.panY + dy;
            return;
        }
        
        // Drag de nœud
        if (this._dragState) {
            const pt = this._getSVGPoint(ev);
            // Chercher dans les nœuds sauvegardés et en attente
            const node = this._getAllNodes().find(n => n.id === this._dragState.id);
            if (node) {
                node.position_x = this._snapToGrid(pt.x - this._dragState.offsetX);
                node.position_y = this._snapToGrid(pt.y - this._dragState.offsetY);
            }
        }
    }
    
    onCanvasMouseUp(ev) {
        if (this.state.isPanning) {
            this.state.isPanning = false;
            this._panStart = null;
        }
        
        if (this._dragState) {
            const node = this.state.nodes.find(n => n.id === this._dragState.id);
            if (node) {
                this._saveNodePosition(node);
            }
            this._dragState = null;
            this.state.isDragging = false;
        }
    }
    
    onNodeMouseDown(node, ev) {
        ev.stopPropagation();
        
        // Si on est en train de connecter, terminer la connexion
        if (this.state.connectingFrom && this.state.connectingFrom !== node.id) {
            ev.preventDefault();
            this.finishConnect(node);
            return;
        }
        
        // Si Shift est maintenu, démarrer une connexion
        if (ev.shiftKey) {
            ev.preventDefault();
            this.startConnect(node);
            this.selectNode(node, ev);
            return;
        }
        
        // Sinon, démarrer le drag du nœud
        ev.preventDefault();
        
        const pt = this._getSVGPoint(ev);
        const d = this._dims(node);
        const offsetX = pt.x - (node.position_x || 0);
        const offsetY = pt.y - (node.position_y || 0);
        
        this._dragState = { id: node.id, offsetX, offsetY };
        this.state.isDragging = true;
        this.selectNode(node, ev);
        
        window.addEventListener("mousemove", this._onMouseMove);
        window.addEventListener("mouseup", this._onMouseUp);
    }
    
    _findNodeById(nodeId) {
        return this._getAllNodes().find(n => n.id === nodeId);
    }
    
    _findEdgeById(edgeId) {
        return this._getAllEdges().find(e => e.id === edgeId);
    }
    
    _onMouseMove = (ev) => {
        this.onCanvasMouseMove(ev);
    };
    
    _onMouseUp = (ev) => {
        this.onCanvasMouseUp(ev);
        window.removeEventListener("mousemove", this._onMouseMove);
        window.removeEventListener("mouseup", this._onMouseUp);
    };
    
    async _saveNodePosition(node) {
        // Si c'est un nœud en attente, pas besoin de sauvegarder (sera créé plus tard)
        if (typeof node.id === 'string' && node.id.startsWith('temp_')) {
            return;
        }
        
        // Sinon, sauvegarder la position
        try {
            await this.orm.write("bpm.node", [node.id], {
                position_x: node.position_x || 0,
                position_y: node.position_y || 0,
            });
        } catch (error) {
            console.error("Erreur lors de la sauvegarde de la position:", error);
        }
    }
    
    zoomIn() {
        this.state.zoom = Math.min(3, this.state.zoom * 1.2);
    }
    
    zoomOut() {
        this.state.zoom = Math.max(0.1, this.state.zoom / 1.2);
    }
    
    resetZoom() {
        this.state.zoom = 1;
        this.state.panX = 0;
        this.state.panY = 0;
    }
    
    toggleSnapToGrid() {
        this.state.snapToGrid = !this.state.snapToGrid;
    }
    
    toggleInstructions() {
        this.state.showInstructions = !this.state.showInstructions;
    }
    
    nodeTransform(node) {
        return `translate(${node.position_x || 0},${node.position_y || 0})`;
    }
    
    edgePath(edge) {
        const sourceId = Array.isArray(edge.source_node_id) ? edge.source_node_id[0] : edge.source_node_id;
        const targetId = Array.isArray(edge.target_node_id) ? edge.target_node_id[0] : edge.target_node_id;
        
        const s = this._getAllNodes().find(n => n.id === sourceId);
        const t = this._getAllNodes().find(n => n.id === targetId);
        if (!s || !t) return "M 0,0 L 0,0";
        
        const sc = this._center(s);
        const tc = this._center(t);
        
        // Courbe de Bézier pour une connexion plus esthétique
        const dx = tc.cx - sc.cx;
        const dy = tc.cy - sc.cy;
        const controlOffset = Math.min(Math.abs(dx), Math.abs(dy)) * 0.5;
        
        return `M ${sc.cx},${sc.cy} C ${sc.cx + controlOffset},${sc.cy} ${tc.cx - controlOffset},${tc.cy} ${tc.cx},${tc.cy}`;
    }
    
    tempConnectionPath() {
        if (!this.state.connectingFrom || !this.state.tempConnectionEnd) return "";
        const source = this.state.connectingFromPoint;
        if (!source) return "";
        
        // Créer une courbe de Bézier pour une connexion plus esthétique
        const dx = this.state.tempConnectionEnd.x - source.cx;
        const dy = this.state.tempConnectionEnd.y - source.cy;
        const controlOffset = Math.min(Math.abs(dx), Math.abs(dy)) * 0.5;
        
        return `M ${source.cx},${source.cy} C ${source.cx + controlOffset},${source.cy} ${this.state.tempConnectionEnd.x - controlOffset},${this.state.tempConnectionEnd.y} ${this.state.tempConnectionEnd.x},${this.state.tempConnectionEnd.y}`;
    }
    
    getNodeClass(node) {
        const classes = ['o_bpm_node'];
        if (this.state.selectedNodeId === node.id) classes.push('o_bpm_selected');
        if (this.state.hoveredNodeId === node.id) classes.push('o_bpm_hovered');
        if (this.state.connectingFrom === node.id) classes.push('o_bpm_node_connecting');
        if (this.isNodeConnectable(node)) classes.push('o_bpm_connectable');
        classes.push(`o_bpm_node_${node.node_type}`);
        return classes.join(' ');
    }
    
    getEdgeClass(edge) {
        const classes = ['o_bpm_edge'];
        if (this.state.selectedEdgeId === edge.id) classes.push('o_bpm_selected');
        return classes.join(' ');
    }
    
    getContainerClass() {
        const classes = [];
        if (this.state.isPanning) classes.push('panning');
        if (this.state.connectingFrom) classes.push('connecting');
        return classes.join(' ');
    }
    
    isNodeConnectable(node) {
        return this.state.connectingFrom && this.state.connectingFrom !== node.id;
    }
    
    getConnectionPointClass(node, pointId) {
        const classes = ['o_bpm_connection_point'];
        if (this.state.connectingFrom) {
            classes.push('visible');
            if (this.isNodeConnectable(node) && this.state.hoveredConnectionPoint === pointId) {
                classes.push('highlighted');
            }
        } else if (this.state.hoveredNodeId === node.id) {
            classes.push('visible');
        }
        return classes.join(' ');
    }
}

registry.category("fields").add("bpm_graph_editor", { component: BpmGraphEditor });
