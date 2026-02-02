/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onMounted, onWillUnmount, useRef } from "@odoo/owl";
import { standardFieldProps } from "@web/views/fields/standard_field_props";

/**
 * Widget personnalisé pour l'éditeur graphique de workflow BPM
 * Utilise SVG pour dessiner les nœuds et les liens
 */
export class BpmEditorWidget extends Component {
    static template = "ODOO_AGILE.BpmEditorWidget";
    static props = {
        ...standardFieldProps,
    };

    setup() {
        this.canvasRef = useRef("canvas");
        this.state = useState({
            nodes: [],
            edges: [],
            selectedNode: null,
            selectedEdge: null,
            isDragging: false,
            dragOffset: { x: 0, y: 0 },
            isConnecting: false,
            connectionStart: null,
            isLoading: true,
            // Pan (déplacement du canvas)
            isPanning: false,
            panOffset: { x: 0, y: 0 },
            panStart: { x: 0, y: 0 },
            // Zoom
            zoom: 1.0,
        });

        onMounted(async () => {
            // Charge la définition depuis la base de données
            await this.loadDefinition();
            this.state.isLoading = false;
            this.initializeCanvas();
        });

        onWillUnmount(() => {
            this.cleanup();
        });
    }

    /**
     * Charge la définition depuis les enregistrements bpm.node et bpm.edge
     */
    async loadDefinition() {
        const processId = this.props.record.resId;
        if (!processId) {
            this.state.nodes = [];
            this.state.edges = [];
            return;
        }

        try {
            // Charge les nœuds depuis bpm.node
            const nodeRecords = await this.env.services.orm.searchRead(
                'bpm.node',
                [['process_id', '=', processId]],
                ['id', 'node_id', 'name', 'node_type', 'position_x', 'position_y']
            );

            // Transforme les enregistrements en format du widget
            this.state.nodes = nodeRecords.map(node => ({
                id: node.node_id,
                recordId: node.id,  // ID de l'enregistrement bpm.node
                name: node.name,
                type: node.node_type,
                x: node.position_x,
                y: node.position_y,
            }));

            // Charge les edges depuis bpm.edge
            const edgeRecords = await this.env.services.orm.searchRead(
                'bpm.edge',
                [['process_id', '=', processId]],
                ['id', 'edge_id', 'source_node_id', 'target_node_id', 'name', 'condition', 'sequence']
            );

            // Transforme les edges - il faut mapper les IDs des nœuds
            this.state.edges = edgeRecords.map(edge => {
                // Trouve les node_id correspondants
                const sourceNode = nodeRecords.find(n => n.id === edge.source_node_id[0]);
                const targetNode = nodeRecords.find(n => n.id === edge.target_node_id[0]);
                
                return {
                    id: edge.edge_id,
                    recordId: edge.id,  // ID de l'enregistrement bpm.edge
                    source: sourceNode ? sourceNode.node_id : null,
                    target: targetNode ? targetNode.node_id : null,
                    name: edge.name || '',
                    condition: edge.condition || '',
                    sequence: edge.sequence || 10,
                };
            }).filter(edge => edge.source && edge.target);  // Filtre les edges invalides

        } catch (e) {
            console.error("Erreur lors du chargement depuis la base:", e);
            this.state.nodes = [];
            this.state.edges = [];
        }
    }

    /**
     * Sauvegarde les nœuds et edges dans la base de données
     */
    async saveDefinition() {
        const processId = this.props.record.resId;
        if (!processId) {
            console.warn("Impossible de sauvegarder: pas de processId");
            return;
        }

        try {
            // 1. Synchronise les nœuds
            for (const node of this.state.nodes) {
                const nodeData = {
                    name: node.name,
                    node_type: node.type,
                    position_x: node.x,
                    position_y: node.y,
                    process_id: processId,
                    node_id: node.id,
                };

                if (node.recordId) {
                    // Mise à jour d'un nœud existant
                    await this.env.services.orm.write('bpm.node', [node.recordId], nodeData);
                } else {
                    // Création d'un nouveau nœud
                    const newId = await this.env.services.orm.create('bpm.node', [nodeData]);
                    node.recordId = newId;
                }
            }

            // 2. Récupère les node_ids actuels pour mapper les edges
            const nodeRecords = await this.env.services.orm.searchRead(
                'bpm.node',
                [['process_id', '=', processId]],
                ['id', 'node_id']
            );
            const nodeIdMap = {};
            nodeRecords.forEach(n => {
                nodeIdMap[n.node_id] = n.id;
            });

            // 3. Synchronise les edges
            for (const edge of this.state.edges) {
                const sourceRecordId = nodeIdMap[edge.source];
                const targetRecordId = nodeIdMap[edge.target];

                if (!sourceRecordId || !targetRecordId) {
                    console.warn("Edge invalide, nœuds introuvables:", edge);
                    continue;
                }

                const edgeData = {
                    process_id: processId,
                    source_node_id: sourceRecordId,
                    target_node_id: targetRecordId,
                    edge_id: edge.id,
                    name: edge.name || `Transition ${edge.source} -> ${edge.target}`,
                    condition: edge.condition || false,
                    sequence: edge.sequence || 10,
                };

                if (edge.recordId) {
                    // Mise à jour d'un edge existant
                    await this.env.services.orm.write('bpm.edge', [edge.recordId], edgeData);
                } else {
                    // Création d'un nouveau edge
                    const newId = await this.env.services.orm.create('bpm.edge', [edgeData]);
                    edge.recordId = newId;
                }
            }

            // 4. Supprime les nœuds et edges qui n'existent plus dans le state
            const currentNodeIds = this.state.nodes.map(n => n.recordId).filter(id => id);
            const currentEdgeIds = this.state.edges.map(e => e.recordId).filter(id => id);

            const allNodeRecords = await this.env.services.orm.searchRead(
                'bpm.node',
                [['process_id', '=', processId]],
                ['id']
            );
            const nodesToDelete = allNodeRecords
                .map(n => n.id)
                .filter(id => !currentNodeIds.includes(id));
            if (nodesToDelete.length > 0) {
                await this.env.services.orm.unlink('bpm.node', nodesToDelete);
            }

            const allEdgeRecords = await this.env.services.orm.searchRead(
                'bpm.edge',
                [['process_id', '=', processId]],
                ['id']
            );
            const edgesToDelete = allEdgeRecords
                .map(e => e.id)
                .filter(id => !currentEdgeIds.includes(id));
            if (edgesToDelete.length > 0) {
                await this.env.services.orm.unlink('bpm.edge', edgesToDelete);
            }

            console.log("Définition sauvegardée avec succès");
        } catch (e) {
            console.error("Erreur lors de la sauvegarde:", e);
        }
    }

    /**
     * Initialise le canvas SVG
     */
    initializeCanvas() {
        const canvas = this.canvasRef.el;
        if (!canvas) return;

        // Ajoute les gestionnaires d'événements
        canvas.addEventListener("click", this.onCanvasClick.bind(this));
        canvas.addEventListener("mousemove", this.onCanvasMouseMove.bind(this));
        canvas.addEventListener("mouseup", this.onCanvasMouseUp.bind(this));
        canvas.addEventListener("mousedown", this.onCanvasMouseDown.bind(this));
        canvas.addEventListener("wheel", this.onCanvasWheel.bind(this), { passive: false });

        // Redessine le canvas
        this.redraw();
    }

    /**
     * Nettoie les événements
     */
    cleanup() {
        const canvas = this.canvasRef.el;
        if (canvas) {
            canvas.removeEventListener("click", this.onCanvasClick);
            canvas.removeEventListener("mousedown", this.onCanvasMouseDown);
            canvas.removeEventListener("wheel", this.onCanvasWheel);
            canvas.removeEventListener("mousemove", this.onCanvasMouseMove);
            canvas.removeEventListener("mouseup", this.onCanvasMouseUp);
        }
    }

    /**
     * Redessine tout le canvas
     */
    redraw() {
        // Cette méthode sera appelée automatiquement par OWL lors du rendu
    }

    /**
     * Gère le clic sur le canvas
     */
    onCanvasClick(event) {
        if (!this.canvasRef.el) return;
        
        // Ignore le clic si on était en train de faire du pan
        if (event.button === 1 || event.shiftKey) return;

        const rect = this.canvasRef.el.getBoundingClientRect();
        const x = (event.clientX - rect.left - this.state.panOffset.x) / this.state.zoom;
        const y = (event.clientY - rect.top - this.state.panOffset.y) / this.state.zoom;

        // Trouve le nœud cliqué
        const clickedNode = this.findNodeAt(x, y);

        // Si on est en mode connexion
        if (this.state.isConnecting && this.state.connectionStart) {
            if (clickedNode && clickedNode.id !== this.state.connectionStart.id) {
                // Crée la connexion entre le nœud de départ et le nœud cliqué
                this.createEdge(this.state.connectionStart.id, clickedNode.id);
            }
            // Désactive le mode connexion
            this.state.isConnecting = false;
            this.state.connectionStart = null;
            return;
        }

        // Sinon, gère la sélection normale
        if (clickedNode) {
            this.selectNode(clickedNode);
        } else {
            // Clic sur le canvas vide : désélectionne
            this.state.selectedNode = null;
            this.state.selectedEdge = null;
        }
    }

    /**
     * Gère le clic initial sur le canvas
     */
    onCanvasMouseDown(event) {
        if (!this.canvasRef.el) return;

        // Bouton du milieu ou Shift+clic gauche = pan
        if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
            event.preventDefault();
            this.state.isPanning = true;
            this.state.panStart = {
                x: event.clientX - this.state.panOffset.x,
                y: event.clientY - this.state.panOffset.y,
            };
        }
    }

    /**
     * Gère le mouvement de la souris sur le canvas
     */
    onCanvasMouseMove(event) {
        if (!this.canvasRef.el) return;
        
        // Mode pan
        if (this.state.isPanning) {
            this.state.panOffset.x = event.clientX - this.state.panStart.x;
            this.state.panOffset.y = event.clientY - this.state.panStart.y;
            return;
        }

        // Mode drag de nœud
        if (this.state.isDragging && this.state.selectedNode) {
            const rect = this.canvasRef.el.getBoundingClientRect();
            const x = (event.clientX - rect.left - this.state.panOffset.x) / this.state.zoom - this.state.dragOffset.x;
            const y = (event.clientY - rect.top - this.state.panOffset.y) / this.state.zoom - this.state.dragOffset.y;
            
            this.state.selectedNode.x = Math.max(0, x);
            this.state.selectedNode.y = Math.max(0, y);
            this.saveDefinition();
        }
    }

    /**
     * Gère le zoom avec la molette
     */
    onCanvasWheel(event) {
        if (!this.canvasRef.el) return;
        event.preventDefault();

        const delta = event.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.2, Math.min(3.0, this.state.zoom * delta));
        
        // Calcule le point focal pour zoomer vers la position de la souris
        const rect = this.canvasRef.el.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        // Ajuste le pan offset pour zoomer vers la souris
        this.state.panOffset.x = mouseX - (mouseX - this.state.panOffset.x) * (newZoom / this.state.zoom);
        this.state.panOffset.y = mouseY - (mouseY - this.state.panOffset.y) * (newZoom / this.state.zoom);
        
        this.state.zoom = newZoom;
    }

    /**
     * Gère le relâchement de la souris
     */
    onCanvasMouseUp(event) {
        if (this.state.isDragging) {
            this.state.isDragging = false;
        }
        if (this.state.isPanning) {
            this.state.isPanning = false;
        }
    }

    /**
     * Trouve un nœud à la position donnée
     */
    findNodeAt(x, y) {
        const nodeSize = 80;
        return this.state.nodes.find(node => {
            return x >= node.x && x <= node.x + nodeSize &&
                   y >= node.y && y <= node.y + nodeSize;
        });
    }

    /**
     * Sélectionne un nœud
     */
    selectNode(node) {
        this.state.selectedNode = node;
        this.state.selectedEdge = null;
    }

    /**
     * Démarre le glisser-déposer d'un nœud
     */
    startDrag(event, node) {
        event.stopPropagation();
        
        // Ne démarre pas le drag si on fait du pan
        if (event.button === 1 || event.shiftKey) return;

        const rect = this.canvasRef.el.getBoundingClientRect();
        const mouseX = (event.clientX - rect.left - this.state.panOffset.x) / this.state.zoom;
        const mouseY = (event.clientY - rect.top - this.state.panOffset.y) / this.state.zoom;
        
        this.state.dragOffset = {
            x: mouseX - node.x,
            y: mouseY - node.y,
        };
        this.state.isDragging = true;
        this.selectNode(node);
    }

    /**
     * Ajoute un nouveau nœud
     */
    addNode(type = "task") {
        const newNode = {
            id: this.generateId(),
            type: type,
            name: this.getNodeTypeLabel(type),
            x: 100 + Math.random() * 200,
            y: 100 + Math.random() * 200,
        };
        this.state.nodes.push(newNode);
        this.saveDefinition();
    }

    /**
     * Supprime le nœud sélectionné
     */
    deleteSelectedNode() {
        if (this.state.selectedNode) {
            const nodeId = this.state.selectedNode.id;
            // Supprime les edges connectés
            this.state.edges = this.state.edges.filter(
                edge => edge.source !== nodeId && edge.target !== nodeId
            );
            // Supprime le nœud
            this.state.nodes = this.state.nodes.filter(node => node.id !== nodeId);
            this.state.selectedNode = null;
            this.saveDefinition();
        }
    }

    /**
     * Démarre la création d'une connexion
     */
    startConnection(node) {
        this.state.isConnecting = true;
        this.state.connectionStart = node;        console.log('Mode connexion activé. Cliquez sur un autre nœud pour créer la connexion.');
        // Affiche un message visuel à l'utilisateur
        if (this.env.services.notification) {
            this.env.services.notification.add(
                'Cliquez sur un nœud cible pour créer la connexion',
                { type: 'info' }
            );
        }    }

    /**
     * Crée une transition entre deux nœuds
     */
    createEdge(sourceId, targetId) {
        // Vérifie si l'edge existe déjà
        const exists = this.state.edges.some(
            edge => edge.source === sourceId && edge.target === targetId
        );
        if (exists) return;

        const newEdge = {
            id: this.generateId(),
            source: sourceId,
            target: targetId,
            name: '',
            condition: '',
            sequence: 10,
        };
        this.state.edges.push(newEdge);
        this.saveDefinition();
    }

    /**
     * Supprime l'edge sélectionné
     */
    deleteSelectedEdge() {
        if (this.state.selectedEdge) {
            this.state.edges = this.state.edges.filter(
                edge => edge.id !== this.state.selectedEdge.id
            );
            this.state.selectedEdge = null;
            this.saveDefinition();
        }
    }

    /**
     * Génère un ID unique
     */
    generateId() {
        return "node_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Retourne le label d'un type de nœud
     */
    getNodeTypeLabel(type) {
        const labels = {
            start: "Début",
            task: "Tâche",
            gateway: "Décision",
            end: "Fin",
        };
        return labels[type] || type;
    }

    /**
     * Retourne la couleur d'un type de nœud
     */
    getNodeColor(type) {
        const colors = {
            start: "#4CAF50",
            task: "#2196F3",
            gateway: "#FF9800",
            end: "#F44336",
        };
        return colors[type] || "#757575";
    }

    /**
     * Calcule les coordonnées d'une flèche entre deux nœuds
     */
    getEdgePath(sourceNode, targetNode) {
        const nodeSize = 80;
        const sourceX = sourceNode.x + nodeSize / 2;
        const sourceY = sourceNode.y + nodeSize / 2;
        const targetX = targetNode.x + nodeSize / 2;
        const targetY = targetNode.y + nodeSize / 2;

        // Ligne simple entre les deux points
        return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
    }

    /**
     * Trouve les nœuds source et cible d'un edge
     */
    getEdgeNodes(edge) {
        const sourceNode = this.state.nodes.find(n => n.id === edge.source);
        const targetNode = this.state.nodes.find(n => n.id === edge.target);
        return { sourceNode, targetNode };
    }
}

// Enregistre le widget dans le registre des champs
registry.category("fields").add("bpm_editor", {
    component: BpmEditorWidget,
    supportedTypes: ["text"],
});

